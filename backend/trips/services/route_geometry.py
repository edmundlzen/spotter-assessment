"""Resolve engine mile markers against waypoint-anchored route geometry."""

from __future__ import annotations

import math
from typing import Iterable

from trips.hos_engine.models import Stop

from .ors_client import ResolvedRoute


METERS_PER_MILE = 1609.344
_BOUNDARY_TOLERANCE_METERS = 1e-6
_EARTH_RADIUS_METERS = 6_371_008.8


def resolve_stops(
    stops: Iterable[Stop], route: ResolvedRoute
) -> list[tuple[float, float]]:
    """Return one GeoJSON ``(longitude, latitude)`` coordinate per stop."""
    leg_slices = _validate_route(route)
    return [
        _resolve_marker(stop.cumulative_miles, route, leg_slices)
        for stop in stops
    ]


def _validate_route(
    route: ResolvedRoute,
) -> tuple[tuple[tuple[float, float], ...], ...]:
    try:
        if len(route.legs) != 2 or len(route.waypoint_indices) != 3:
            raise ValueError
        if not _is_positive_finite(route.total_meters):
            raise ValueError
        geometry = tuple(_validated_coordinate(point) for point in route.geometry)
        if len(geometry) < 3:
            raise ValueError

        indices = route.waypoint_indices
        if (
            any(isinstance(index, bool) or not isinstance(index, int) for index in indices)
            or indices[0] != 0
            or indices[-1] != len(geometry) - 1
            or not indices[0] < indices[1] < indices[2]
        ):
            raise ValueError

        slices = []
        for position, leg in enumerate(route.legs):
            if (
                not _is_positive_finite(leg.distance_meters)
                or leg.start_waypoint_index != indices[position]
                or leg.end_waypoint_index != indices[position + 1]
            ):
                raise ValueError
            leg_slice = geometry[
                leg.start_waypoint_index : leg.end_waypoint_index + 1
            ]
            if _line_length(leg_slice) <= 0:
                raise ValueError
            slices.append(leg_slice)

        if not math.isclose(
            sum(leg.distance_meters for leg in route.legs),
            route.total_meters,
            rel_tol=1e-9,
            abs_tol=_BOUNDARY_TOLERANCE_METERS,
        ):
            raise ValueError
    except (AttributeError, TypeError, ValueError, IndexError):
        raise ValueError("route geometry is invalid") from None
    return tuple(slices)


def _resolve_marker(
    marker_miles: float,
    route: ResolvedRoute,
    leg_slices: tuple[tuple[tuple[float, float], ...], ...],
) -> tuple[float, float]:
    if (
        isinstance(marker_miles, bool)
        or not isinstance(marker_miles, (int, float))
        or not math.isfinite(marker_miles)
    ):
        raise ValueError("stop marker must be a finite number")

    target_meters = float(marker_miles) * METERS_PER_MILE
    if target_meters < -_BOUNDARY_TOLERANCE_METERS:
        raise ValueError("stop marker is before the route")
    if target_meters > route.total_meters + _BOUNDARY_TOLERANCE_METERS:
        raise ValueError("stop marker is beyond the route")
    if target_meters <= _BOUNDARY_TOLERANCE_METERS:
        return route.geometry[route.waypoint_indices[0]]
    if (
        abs(target_meters - route.total_meters)
        <= _BOUNDARY_TOLERANCE_METERS
    ):
        return route.geometry[route.waypoint_indices[-1]]

    cumulative_start = 0.0
    for position, leg in enumerate(route.legs):
        cumulative_end = cumulative_start + leg.distance_meters
        if abs(target_meters - cumulative_start) <= _BOUNDARY_TOLERANCE_METERS:
            return route.geometry[route.waypoint_indices[position]]
        if abs(target_meters - cumulative_end) <= _BOUNDARY_TOLERANCE_METERS:
            return route.geometry[route.waypoint_indices[position + 1]]
        if cumulative_start < target_meters < cumulative_end:
            fraction = (
                (target_meters - cumulative_start) / leg.distance_meters
            )
            return _interpolate_line(leg_slices[position], fraction)
        cumulative_start = cumulative_end

    raise ValueError("stop marker cannot be located on the route")


def _interpolate_line(
    coordinates: tuple[tuple[float, float], ...], fraction: float
) -> tuple[float, float]:
    pair_lengths = [
        _haversine(start, end)
        for start, end in zip(coordinates, coordinates[1:])
    ]
    total_length = sum(pair_lengths)
    target = total_length * fraction
    traversed = 0.0

    for start, end, pair_length in zip(
        coordinates, coordinates[1:], pair_lengths
    ):
        pair_end = traversed + pair_length
        if pair_length > 0 and target <= pair_end:
            pair_fraction = (target - traversed) / pair_length
            return (
                start[0] + (end[0] - start[0]) * pair_fraction,
                start[1] + (end[1] - start[1]) * pair_fraction,
            )
        traversed = pair_end
    return coordinates[-1]


def _line_length(coordinates: tuple[tuple[float, float], ...]) -> float:
    return sum(
        _haversine(start, end)
        for start, end in zip(coordinates, coordinates[1:])
    )


def _haversine(
    start: tuple[float, float], end: tuple[float, float]
) -> float:
    lon1, lat1 = map(math.radians, start)
    lon2, lat2 = map(math.radians, end)
    delta_lon = lon2 - lon1
    delta_lat = lat2 - lat1
    haversine = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1)
        * math.cos(lat2)
        * math.sin(delta_lon / 2) ** 2
    )
    return 2 * _EARTH_RADIUS_METERS * math.asin(min(1.0, math.sqrt(haversine)))


def _validated_coordinate(value: object) -> tuple[float, float]:
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValueError
    longitude, latitude = value
    if (
        isinstance(longitude, bool)
        or isinstance(latitude, bool)
        or not isinstance(longitude, (int, float))
        or not isinstance(latitude, (int, float))
        or not math.isfinite(longitude)
        or not math.isfinite(latitude)
        or not -180 <= longitude <= 180
        or not -90 <= latitude <= 90
    ):
        raise ValueError
    return float(longitude), float(latitude)


def _is_positive_finite(value: object) -> bool:
    return (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(value)
        and value > 0
    )
