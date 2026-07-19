import json
from dataclasses import replace
from datetime import datetime
from unittest.mock import Mock

import pytest

from trips.models import Trip
from trips.services.ors_client import ResolvedRouteLeg, RouteUnavailableError
from trips.services.snapshot import build_snapshot
from trips.services.trip_creation import TripCreationError, create_trip


def _route_with_leg_durations(route, *duration_seconds):
    total_seconds = sum(duration_seconds)
    legs = tuple(
        ResolvedRouteLeg(
            distance_meters=leg.distance_meters,
            duration_seconds=duration,
            start_waypoint_index=leg.start_waypoint_index,
            end_waypoint_index=leg.end_waypoint_index,
        )
        for leg, duration in zip(route.legs, duration_seconds)
    )
    return replace(route, total_seconds=total_seconds, legs=legs)


def _client_for_route(values, route):
    client = Mock()
    client.geocode.side_effect = values["locations"]
    client.route.return_value = route
    return client


def test_snapshot_is_complete_versioned_json_with_caller_identity(
    trip_creation_values,
):
    values = trip_creation_values

    snapshot = build_snapshot(**values)

    assert json.loads(json.dumps(snapshot)) == snapshot
    assert snapshot["schema_version"] == 1
    assert snapshot["trip"] == {
        "id": str(values["trip_id"]),
        "departure_local": "2026-07-18T08:00:00",
        "departure_assumed": True,
        "cycle_hours_used": 12.5,
    }
    assert set(snapshot) == {
        "schema_version",
        "trip",
        "locations",
        "route",
        "stops",
        "duty_segments",
        "log_days",
        "summary",
    }
    assert snapshot["route"]["profile"] == "driving-hgv"
    assert snapshot["route"]["total_distance_miles"] == 3.0
    assert snapshot["route"]["legs"] == [
        {"from": "current", "to": "pickup", "distance_miles": 1.0, "duration_minutes": 120},
        {"from": "pickup", "to": "dropoff", "distance_miles": 2.0, "duration_minutes": 240},
    ]
    assert all(
        sum(day["status_totals_minutes"].values()) == 1440
        for day in snapshot["log_days"]
    )
    assert snapshot["summary"] == {
        "total_distance_miles": 3.0,
        "total_duration_minutes": 360,
        "leg_count": 2,
        "stop_count": len(snapshot["stops"]),
        "duty_segment_count": len(snapshot["duty_segments"]),
        "log_day_count": len(snapshot["log_days"]),
    }


@pytest.mark.django_db
def test_create_trip_persists_once_and_normalizes_leg_durations(
    trip_creation_values,
):
    values = trip_creation_values
    route = _route_with_leg_durations(values["route"], 89, 89)

    trip = create_trip(
        values["validated"],
        client=_client_for_route(values, route),
        clock=lambda: datetime(2026, 7, 18),
    )

    snapshot = trip.result_snapshot
    assert [leg["duration_minutes"] for leg in snapshot["route"]["legs"]] == [1, 1]
    assert snapshot["route"]["total_duration_minutes"] == 2
    assert sum(day["total_miles"] for day in snapshot["log_days"]) == pytest.approx(
        snapshot["route"]["total_distance_miles"]
    )
    assert Trip.objects.count() == 1


@pytest.mark.django_db
def test_unroutable_route_is_categorized_apart_from_a_provider_outage(
    trip_creation_values,
):
    values = trip_creation_values

    class UnroutableClient:
        def __init__(self):
            self.index = 0

        def geocode(self, query):
            location = values["locations"][self.index]
            self.index += 1
            return location

        def route(self, locations):
            raise RouteUnavailableError(
                "No drivable route exists for the entered locations."
            )

    with pytest.raises(TripCreationError) as caught:
        create_trip(
            values["validated"],
            client=UnroutableClient(),
            clock=lambda: datetime(2026, 7, 18),
        )

    assert caught.value.category == "unroutable"
    assert Trip.objects.count() == 0
