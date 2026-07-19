"""Normalize a complete computed trip into the stable stored JSON contract."""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

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
    leg_duration_minutes,
):
    """Return the complete JSON-primitive snapshot stored for this trip."""
    departure_local = departure.isoformat(timespec="seconds")
    route_miles_decimal = _miles_decimal(
        route.total_meters / METERS_PER_MILE
    )
    route_miles = float(route_miles_decimal)
    total_duration_minutes = sum(leg_duration_minutes)

    normalized_locations = {
        role: {
            "query": location.original_query,
            "label": location.display_label,
            "coordinate": [location.longitude, location.latitude],
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
            "duration_minutes": duration_minutes,
        }
        for (start, end), leg, duration_minutes in zip(
            _LEG_ENDPOINTS,
            route.legs,
            leg_duration_minutes,
        )
    ]
    duty_segments = [
        _normalize_segment(segment) for segment in schedule.segments
    ]
    stops = [
        {
            "kind": stop.kind,
            "cumulative_miles": float(
                _miles_decimal(stop.cumulative_miles)
            ),
            "coordinate": list(coordinate),
            "start": stop.segment.start.isoformat(timespec="seconds"),
            "end": stop.segment.end.isoformat(timespec="seconds"),
            "status": stop.segment.status.value,
            "note": stop.segment.note,
        }
        for stop, coordinate in zip(schedule.stops, resolved_stops)
    ]
    normalized_log_days = _normalize_log_days(
        log_days,
        route.legs,
        leg_duration_minutes,
    )

    summary = {
        "total_distance_miles": route_miles,
        "total_duration_minutes": total_duration_minutes,
        "leg_count": len(route_legs),
        "stop_count": len(stops),
        "duty_segment_count": len(duty_segments),
        "log_day_count": len(normalized_log_days),
    }
    snapshot = {
        "schema_version": 1,
        "trip": {
            "id": str(trip_id),
            "departure_local": departure_local,
            "departure_assumed": True,
            "cycle_hours_used": float(validated["cycle_hours_used"]),
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
                    list(coordinate) for coordinate in route.geometry
                ],
            },
        },
        "stops": stops,
        "duty_segments": duty_segments,
        "log_days": normalized_log_days,
        "summary": summary,
    }
    return snapshot


def _normalize_log_days(log_days, route_legs, leg_duration_minutes):
    leg_remaining = [
        [
            duration_minutes,
            float(_miles_decimal(leg.distance_meters / METERS_PER_MILE)),
        ]
        for leg, duration_minutes in zip(route_legs, leg_duration_minutes)
    ]
    leg_index = 0
    normalized_days = []

    for log_day in log_days:
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
    return {
        "status": segment.status.value,
        "start": segment.start.isoformat(timespec="seconds"),
        "end": segment.end.isoformat(timespec="seconds"),
        "duration_minutes": segment.duration_minutes,
        "note": segment.note,
    }


def _miles_decimal(value):
    return Decimal(str(value)).quantize(
        _MILES_QUANTUM, rounding=ROUND_HALF_UP
    )
