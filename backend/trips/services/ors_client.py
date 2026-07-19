"""Strict server-side boundary for the two OpenRouteService capabilities."""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any, Iterable

import requests


_GEOCODE_URL = "https://api.openrouteservice.org/geocode/search"
_ROUTE_URL = (
    "https://api.openrouteservice.org/v2/directions/driving-hgv/geojson"
)
_RETRYABLE_STATUSES = {429}

_ROUTE_INPUT_ERROR_CODES = {2004, 2009, 2010}

_ROUTE_SNAP_RADIUSES = [-1, -1, -1]


class ProviderError(RuntimeError):
    """A secret-safe provider failure suitable for application translation."""


class RouteUnavailableError(ProviderError):
    """The entered locations themselves cannot be routed.

    Distinct from a provider outage: the coordinates are the problem
    (unroutable point, disconnected road networks, or a distance limit), so the
    caller should ask the user to refine the locations rather than retry.
    """


@dataclass(frozen=True)
class ResolvedLocation:
    original_query: str
    display_label: str
    longitude: float
    latitude: float


@dataclass(frozen=True)
class ResolvedRouteLeg:
    distance_meters: float
    duration_seconds: float
    start_waypoint_index: int
    end_waypoint_index: int


@dataclass(frozen=True)
class ResolvedRoute:
    total_meters: float
    total_seconds: float
    legs: tuple[ResolvedRouteLeg, ResolvedRouteLeg]
    geometry: tuple[tuple[float, float], ...]
    waypoint_indices: tuple[int, int, int]


class ORSClient:
    """Request-scoped, injectable OpenRouteService HTTP adapter."""

    def __init__(
        self,
        api_key: str,
        connect_timeout: float,
        read_timeout: float,
        max_retries: int,
        session: requests.Session | None = None,
    ) -> None:
        if not isinstance(api_key, str) or not api_key.strip():
            raise ValueError("api_key must be a non-empty string")
        self._connect_timeout = _positive_finite(
            connect_timeout, "connect_timeout"
        )
        self._read_timeout = _positive_finite(read_timeout, "read_timeout")
        if isinstance(max_retries, bool) or max_retries not in {0, 1}:
            raise ValueError("max_retries must be 0 or 1")

        self._headers = {"Authorization": api_key}
        self._max_retries = max_retries
        self._session = session if session is not None else requests.Session()

    def geocode(self, query: str) -> ResolvedLocation | None:
        matches = self.search(query, limit=1)
        return matches[0] if matches else None

    def search(
        self, query: str, *, limit: int = 5
    ) -> tuple[ResolvedLocation, ...]:
        """Return ordered US location suggestions for an entered query."""
        if not isinstance(query, str) or not query.strip():
            raise ValueError("query must be a non-empty string")
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 10:
            raise ValueError("limit must be an integer from 1 to 10")

        response = self._request(
            "get",
            _GEOCODE_URL,
            params={
                "text": query,
                "boundary.country": "USA",
                "size": limit,
            },
        )
        payload = self._json(response)
        try:
            if not isinstance(payload, dict):
                raise ValueError
            features = payload["features"]
            if not isinstance(features, list):
                raise ValueError
            locations = []
            seen = set()
            for feature in features:
                label = feature["properties"]["label"]
                geometry = feature["geometry"]
                coordinates = geometry["coordinates"]
                if (
                    not isinstance(label, str)
                    or not label.strip()
                    or geometry["type"] != "Point"
                ):
                    raise ValueError
                longitude, latitude = _coordinate(coordinates)
                identity = (label.casefold(), longitude, latitude)
                if identity in seen:
                    continue
                seen.add(identity)
                locations.append(
                    ResolvedLocation(
                        original_query=query,
                        display_label=label,
                        longitude=longitude,
                        latitude=latitude,
                    )
                )
        except (KeyError, TypeError, ValueError):
            raise _invalid_payload() from None

        return tuple(locations)

    def route(
        self, locations: Iterable[ResolvedLocation]
    ) -> ResolvedRoute:
        resolved_locations = tuple(locations)
        if len(resolved_locations) != 3:
            raise ValueError("route requires exactly three locations")
        coordinates: list[list[float]] = []
        for location in resolved_locations:
            if not isinstance(location, ResolvedLocation):
                raise ValueError("route locations must be ResolvedLocation values")
            longitude, latitude = _coordinate(
                [location.longitude, location.latitude]
            )
            coordinates.append([longitude, latitude])

        response = self._request(
            "post",
            _ROUTE_URL,
            json={
                "coordinates": coordinates,
                "radiuses": _ROUTE_SNAP_RADIUSES,
            },
        )
        return _parse_route(self._json(response))

    def _request(self, method: str, url: str, **kwargs: Any) -> Any:
        attempts = self._max_retries + 1
        for attempt in range(attempts):
            try:
                response = getattr(self._session, method)(
                    url,
                    **kwargs,
                    headers=self._headers,
                    timeout=(self._connect_timeout, self._read_timeout),
                )
            except requests.ConnectTimeout:
                if attempt + 1 < attempts:
                    continue
                raise _unavailable() from None
            except requests.RequestException:
                raise _unavailable() from None

            status = response.status_code
            retryable = status in _RETRYABLE_STATUSES or status >= 500
            if retryable and attempt + 1 < attempts:
                continue
            if status < 200 or status >= 300:
                raise _http_failure(response)
            return response
        raise _unavailable()

    @staticmethod
    def _json(response: Any) -> Any:
        try:
            return response.json()
        except (ValueError, TypeError):
            raise _invalid_payload() from None


def _parse_route(payload: Any) -> ResolvedRoute:
    try:
        if not isinstance(payload, dict):
            raise ValueError
        features = payload["features"]
        if not isinstance(features, list) or len(features) != 1:
            raise ValueError
        feature = features[0]
        properties = feature["properties"]
        summary = properties["summary"]
        total_meters = _positive_finite(summary["distance"], "distance")
        total_seconds = _positive_finite(summary["duration"], "duration")

        raw_segments = properties["segments"]
        if not isinstance(raw_segments, list) or len(raw_segments) != 2:
            raise ValueError
        raw_waypoints = properties["way_points"]
        if (
            not isinstance(raw_waypoints, list)
            or len(raw_waypoints) != 3
            or any(
                isinstance(value, bool) or not isinstance(value, int)
                for value in raw_waypoints
            )
        ):
            raise ValueError

        geometry_payload = feature["geometry"]
        if geometry_payload["type"] != "LineString":
            raise ValueError
        raw_coordinates = geometry_payload["coordinates"]
        if not isinstance(raw_coordinates, list) or len(raw_coordinates) < 3:
            raise ValueError
        geometry = tuple(_coordinate(point) for point in raw_coordinates)

        legs = tuple(
            _parse_leg(
                segment,
                start_waypoint_index=raw_waypoints[index],
                end_waypoint_index=raw_waypoints[index + 1],
            )
            for index, segment in enumerate(raw_segments)
        )
        first, second = legs
        if (
            first.start_waypoint_index != 0
            or first.end_waypoint_index != second.start_waypoint_index
            or second.end_waypoint_index != len(geometry) - 1
            or first.start_waypoint_index >= first.end_waypoint_index
            or second.start_waypoint_index >= second.end_waypoint_index
            or any(
                len(
                    set(
                        geometry[
                            leg.start_waypoint_index : leg.end_waypoint_index + 1
                        ]
                    )
                )
                < 2
                for leg in legs
            )
        ):
            raise ValueError
        if not math.isclose(
            sum(leg.distance_meters for leg in legs),
            total_meters,
            rel_tol=1e-6,
            abs_tol=1.0,
        ):
            raise ValueError
        if not math.isclose(
            sum(leg.duration_seconds for leg in legs),
            total_seconds,
            rel_tol=1e-6,
            abs_tol=1.0,
        ):
            raise ValueError
    except (KeyError, TypeError, ValueError, IndexError):
        raise _invalid_payload() from None

    return ResolvedRoute(
        total_meters=total_meters,
        total_seconds=total_seconds,
        legs=legs,
        geometry=geometry,
        waypoint_indices=(
            first.start_waypoint_index,
            first.end_waypoint_index,
            second.end_waypoint_index,
        ),
    )


def _parse_leg(
    payload: Any,
    *,
    start_waypoint_index: int,
    end_waypoint_index: int,
) -> ResolvedRouteLeg:
    if not isinstance(payload, dict):
        raise ValueError
    return ResolvedRouteLeg(
        distance_meters=_positive_finite(payload["distance"], "distance"),
        duration_seconds=_positive_finite(payload["duration"], "duration"),
        start_waypoint_index=start_waypoint_index,
        end_waypoint_index=end_waypoint_index,
    )


def _coordinate(value: Any) -> tuple[float, float]:
    if not isinstance(value, (list, tuple)) or len(value) < 2:
        raise ValueError
    longitude = _finite_number(value[0], "longitude")
    latitude = _finite_number(value[1], "latitude")
    if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
        raise ValueError
    return longitude, latitude


def _finite_number(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"{name} must be finite")
    return result


def _positive_finite(value: Any, name: str) -> float:
    result = _finite_number(value, name)
    if result <= 0:
        raise ValueError(f"{name} must be positive")
    return result


def _http_failure(response: Any) -> ProviderError:
    """Classify a non-2xx provider response as a routing-input error or outage.

    Reads the ORS error code from the body when present: a recognized
    routing-input code becomes a RouteUnavailableError (the locations can't be
    routed); anything else stays a generic, secret-safe unavailability.
    """
    try:
        body = response.json()
    except (ValueError, TypeError):
        body = None
    code = None
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            code = error.get("code")
    if code in _ROUTE_INPUT_ERROR_CODES:
        return RouteUnavailableError(
            "No drivable route exists for the entered locations."
        )
    return _unavailable()


def _invalid_payload() -> ProviderError:
    return ProviderError("The routing provider returned an invalid response.")


def _unavailable() -> ProviderError:
    return ProviderError("The routing provider is unavailable.")
