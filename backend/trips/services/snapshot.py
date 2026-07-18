"""Normalize a complete computed trip into the stable stored JSON contract."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
import math
from uuid import UUID

from trips.hos_engine.models import DutySegment, DutyStatus
from trips.services.route_geometry import METERS_PER_MILE


_MILES_QUANTUM = Decimal("0.001")
_LOCATION_ROLES = ("current", "pickup", "dropoff")
_LEG_ENDPOINTS = (("current", "pickup"), ("pickup", "dropoff"))


def build_snapshot(
    *,
    trip_id,
    validated,
    locations,
    route,
    schedule,
    resolved_stops,
    log_days,
    departure,
):
    """Return a JSON-primitive schema and compact model creation fields."""
    if not isinstance(trip_id, UUID):
        raise ValueError("trip_id must be a UUID")
    if len(locations) != 3:
        raise ValueError("exactly three resolved locations are required")
    if len(route.legs) != 2:
        raise ValueError("exactly two route legs are required")
    if len(schedule.stops) != len(resolved_stops):
        raise ValueError("every schedule stop requires one coordinate")

    departure_local = _iso_local(departure)
    route_miles_decimal = _miles_decimal(
        route.total_meters / METERS_PER_MILE
    )
    route_miles = float(route_miles_decimal)
    total_duration_minutes = _minutes(route.total_seconds)

    normalized_locations = {
        role: {
            "query": _text(location.original_query, "location query"),
            "label": _text(location.display_label, "location label"),
            "coordinate": _coordinate(
                (location.longitude, location.latitude)
            ),
        }
        for role, location in zip(_LOCATION_ROLES, locations)
    }
    route_legs = [
        {
            "from": start,
            "to": end,
            "distance_miles": float(
                _miles_decimal(leg.distance_meters / METERS_PER_MILE)
            ),
            "duration_minutes": _minutes(leg.duration_seconds),
        }
        for (start, end), leg in zip(_LEG_ENDPOINTS, route.legs)
    ]
    duty_segments = [
        _normalize_segment(segment) for segment in schedule.segments
    ]
    stops = [
        {
            "kind": _text(stop.kind, "stop kind"),
            "cumulative_miles": float(
                _miles_decimal(stop.cumulative_miles)
            ),
            "coordinate": _coordinate(coordinate),
            "start": _iso_local(stop.segment.start),
            "end": _iso_local(stop.segment.end),
            "status": _status(stop.segment.status),
            "note": _note(stop.segment.note),
        }
        for stop, coordinate in zip(schedule.stops, resolved_stops)
    ]
    normalized_log_days = _normalize_log_days(log_days, route.legs)

    summary = {
        "total_distance_miles": route_miles_decimal,
        "total_duration_minutes": total_duration_minutes,
        "leg_count": len(route_legs),
        "stop_count": len(stops),
        "duty_segment_count": len(duty_segments),
        "log_day_count": len(normalized_log_days),
    }
    snapshot_summary = {
        **summary,
        "total_distance_miles": route_miles,
    }
    snapshot = {
        "schema_version": 1,
        "trip": {
            "id": str(trip_id),
            "departure_local": departure_local,
            "departure_assumed": True,
            "cycle_hours_used": _finite_number(
                validated["cycle_hours_used"], "cycle_hours_used"
            ),
        },
        "locations": normalized_locations,
        "route": {
            "profile": "driving-hgv",
            "total_distance_miles": route_miles,
            "total_duration_minutes": total_duration_minutes,
            "legs": route_legs,
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    _coordinate(coordinate) for coordinate in route.geometry
                ],
            },
        },
        "stops": stops,
        "duty_segments": duty_segments,
        "log_days": normalized_log_days,
        "summary": snapshot_summary,
    }
    return snapshot, summary


def _normalize_log_days(log_days, route_legs):
    leg_remaining = [
        [
            _minutes(leg.duration_seconds),
            float(_miles_decimal(leg.distance_meters / METERS_PER_MILE)),
        ]
        for leg in route_legs
    ]
    leg_index = 0
    normalized_days = []

    for log_day in log_days:
        if not isinstance(log_day.date, date):
            raise ValueError("log day date is invalid")
        status_totals = {status.value: 0 for status in DutyStatus}
        day_miles = 0.0
        segments = []
        for segment in log_day.segments:
            normalized = _normalize_segment(segment)
            segments.append(normalized)
            status_totals[normalized["status"]] += normalized[
                "duration_minutes"
            ]
            if segment.status != DutyStatus.DRIVING:
                continue

            minutes_left = segment.duration_minutes
            while minutes_left:
                if leg_index >= len(leg_remaining):
                    raise ValueError("driving timeline exceeds route duration")
                remaining_minutes, remaining_miles = leg_remaining[leg_index]
                consumed = min(minutes_left, remaining_minutes)
                allocated = remaining_miles * consumed / remaining_minutes
                day_miles += allocated
                minutes_left -= consumed
                remaining_minutes -= consumed
                remaining_miles -= allocated
                if remaining_minutes == 0:
                    leg_index += 1
                else:
                    leg_remaining[leg_index] = [
                        remaining_minutes,
                        remaining_miles,
                    ]

        normalized_days.append(
            {
                "date": log_day.date.isoformat(),
                "total_miles": float(_miles_decimal(day_miles)),
                "status_totals_minutes": status_totals,
                "segments": segments,
            }
        )

    if leg_index != len(leg_remaining):
        raise ValueError("driving timeline does not cover the complete route")
    return normalized_days


def _normalize_segment(segment: DutySegment):
    if not isinstance(segment, DutySegment):
        raise ValueError("duty segment is invalid")
    return {
        "status": _status(segment.status),
        "start": _iso_local(segment.start),
        "end": _iso_local(segment.end),
        "duration_minutes": segment.duration_minutes,
        "note": _note(segment.note),
    }


def _status(value):
    if not isinstance(value, DutyStatus):
        raise ValueError("duty status is invalid")
    return value.value


def _iso_local(value):
    if not isinstance(value, datetime) or value.utcoffset() is not None:
        raise ValueError("timeline datetimes must be timezone-naive")
    return value.isoformat(timespec="seconds")


def _coordinate(value):
    if not isinstance(value, (tuple, list)) or len(value) != 2:
        raise ValueError("coordinate must contain longitude and latitude")
    longitude = _finite_number(value[0], "longitude")
    latitude = _finite_number(value[1], "latitude")
    if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
        raise ValueError("coordinate is outside GeoJSON bounds")
    return [longitude, latitude]


def _minutes(seconds):
    value = _finite_number(seconds, "duration")
    if value <= 0:
        raise ValueError("duration must be positive")
    return round(value / 60)


def _miles_decimal(value):
    finite = _finite_number(value, "mileage")
    if finite < 0:
        raise ValueError("mileage must be non-negative")
    return Decimal(str(finite)).quantize(
        _MILES_QUANTUM, rounding=ROUND_HALF_UP
    )


def _finite_number(value, name):
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float, Decimal))
        or not math.isfinite(float(value))
    ):
        raise ValueError(f"{name} must be a finite number")
    return float(value)


def _text(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be nonblank")
    return value


def _note(value):
    if not isinstance(value, str):
        raise ValueError("segment note must be text")
    return value
