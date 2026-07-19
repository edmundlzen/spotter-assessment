import json
from dataclasses import replace
from datetime import datetime
from unittest.mock import Mock

import pytest

from trips.models import Trip
from trips.services.ors_client import ProviderError, ResolvedRouteLeg
from trips.services.snapshot import build_snapshot
from trips.services.trip_creation import TripCreationError, create_trip


def _route_with_leg_durations(route, *duration_seconds):
    total_seconds = (
        sum(duration_seconds)
        if all(isinstance(value, (int, float)) for value in duration_seconds)
        else route.total_seconds
    )
    legs = tuple(
        ResolvedRouteLeg(
            distance_meters=leg.distance_meters,
            duration_seconds=duration,
            start_waypoint_index=leg.start_waypoint_index,
            end_waypoint_index=leg.end_waypoint_index,
        )
        for leg, duration in zip(route.legs, duration_seconds)
    )
    return replace(
        route,
        total_seconds=total_seconds,
        legs=legs,
    )


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

    assert snapshot["locations"] == {
        "current": {
            "query": "Current query",
            "label": "Current label",
            "coordinate": [-87.0, 41.0],
        },
        "pickup": {
            "query": "Pickup query",
            "label": "Pickup label",
            "coordinate": [-86.99, 41.0],
        },
        "dropoff": {
            "query": "Dropoff query",
            "label": "Dropoff label",
            "coordinate": [-86.97, 41.0],
        },
    }
    assert snapshot["route"]["profile"] == "driving-hgv"
    assert snapshot["route"]["total_distance_miles"] == 3.0
    assert snapshot["route"]["total_duration_minutes"] == 360
    assert snapshot["route"]["legs"] == [
        {
            "from": "current",
            "to": "pickup",
            "distance_miles": 1.0,
            "duration_minutes": 120,
        },
        {
            "from": "pickup",
            "to": "dropoff",
            "distance_miles": 2.0,
            "duration_minutes": 240,
        },
    ]
    assert snapshot["route"]["geometry"] == {
        "type": "LineString",
        "coordinates": [
            [-87.0, 41.0],
            [-86.995, 41.0],
            [-86.99, 41.0],
            [-86.98, 41.0],
            [-86.97, 41.0],
        ],
    }

    assert len(snapshot["stops"]) == len(values["schedule"].stops)
    assert [stop["kind"] for stop in snapshot["stops"]] == [
        stop.kind for stop in values["schedule"].stops
    ]
    assert all(
        set(stop)
        == {
            "kind",
            "cumulative_miles",
            "coordinate",
            "start",
            "end",
            "status",
            "note",
        }
        for stop in snapshot["stops"]
    )
    assert len(snapshot["duty_segments"]) == len(values["schedule"].segments)
    assert all(
        set(segment)
        == {"status", "start", "end", "duration_minutes", "note"}
        for segment in snapshot["duty_segments"]
    )
    assert len(snapshot["log_days"]) == len(values["log_days"])
    assert all(
        sum(day["status_totals_minutes"].values()) == 1440
        for day in snapshot["log_days"]
    )
    assert sum(day["total_miles"] for day in snapshot["log_days"]) == 3.0

    expected_summary = {
        "total_distance_miles": 3.0,
        "total_duration_minutes": 360,
        "leg_count": 2,
        "stop_count": len(snapshot["stops"]),
        "duty_segment_count": len(snapshot["duty_segments"]),
        "log_day_count": len(snapshot["log_days"]),
    }
    assert snapshot["summary"] == expected_summary


def test_snapshot_local_timestamps_never_gain_an_offset(trip_creation_values):
    snapshot = build_snapshot(**trip_creation_values)

    timestamps = [
        snapshot["trip"]["departure_local"],
        *(
            timestamp
            for segment in snapshot["duty_segments"]
            for timestamp in (segment["start"], segment["end"])
        ),
        *(
            timestamp
            for stop in snapshot["stops"]
            for timestamp in (stop["start"], stop["end"])
        ),
    ]

    assert all(
        not timestamp.endswith("Z")
        and "+" not in timestamp
        and timestamp.count("-") == 2
        for timestamp in timestamps
    )


@pytest.mark.django_db
def test_sub_minute_route_legs_share_one_positive_normalized_duration(
    monkeypatch, trip_creation_values
):
    from trips.services import trip_creation

    values = trip_creation_values
    route = _route_with_leg_durations(values["route"], 20, 20)
    real_simulate = trip_creation.simulate
    real_build_snapshot = trip_creation.build_snapshot
    captured = {}

    def capture_simulate(legs, *args, **kwargs):
        captured["engine_legs"] = legs
        return real_simulate(legs, *args, **kwargs)

    def capture_snapshot(**kwargs):
        captured["snapshot_minutes"] = kwargs["leg_duration_minutes"]
        return real_build_snapshot(**kwargs)

    monkeypatch.setattr(trip_creation, "simulate", capture_simulate)
    monkeypatch.setattr(trip_creation, "build_snapshot", capture_snapshot)

    trip = create_trip(
        values["validated"],
        client=_client_for_route(values, route),
        clock=lambda: datetime(2026, 7, 18),
    )

    snapshot = trip.result_snapshot
    assert [leg.duration_hours for leg in captured["engine_legs"]] == [
        1 / 60,
        1 / 60,
    ]
    assert captured["snapshot_minutes"] == (1, 1)
    assert sum(
        segment["duration_minutes"]
        for segment in snapshot["duty_segments"]
        if segment["status"] == "driving"
    ) == 2
    assert [
        leg["duration_minutes"] for leg in snapshot["route"]["legs"]
    ] == [1, 1]
    assert snapshot["route"]["total_duration_minutes"] == 2
    assert snapshot["summary"]["total_duration_minutes"] == 2
    assert sum(day["total_miles"] for day in snapshot["log_days"]) == pytest.approx(
        snapshot["route"]["total_distance_miles"]
    )
    assert Trip.objects.count() == 1


@pytest.mark.django_db
def test_fractional_minute_route_total_is_sum_of_normalized_legs(
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
    assert round(route.total_seconds / 60) == 3
    assert [
        leg["duration_minutes"] for leg in snapshot["route"]["legs"]
    ] == [1, 1]
    assert snapshot["route"]["total_duration_minutes"] == 2
    assert snapshot["summary"]["total_duration_minutes"] == 2
    assert sum(
        segment["duration_minutes"]
        for segment in snapshot["duty_segments"]
        if segment["status"] == "driving"
    ) == 2
    assert sum(day["total_miles"] for day in snapshot["log_days"]) == pytest.approx(
        snapshot["route"]["total_distance_miles"]
    )
    assert Trip.objects.count() == 1


@pytest.mark.django_db
def test_unresolved_location_is_role_aware_and_stops_before_route(
    trip_creation_values,
):
    values = trip_creation_values

    class UnresolvedClient:
        def __init__(self):
            self.queries = []
            self.route = Mock(side_effect=AssertionError("route must not run"))

        def geocode(self, query):
            self.queries.append(query)
            if query == "Pickup query":
                return None
            return values["locations"][0]

    client = UnresolvedClient()

    with pytest.raises(TripCreationError) as caught:
        create_trip(values["validated"], client=client, clock=datetime.now)

    assert caught.value.category == "unresolved_location"
    assert caught.value.field == "pickup_location"
    assert str(caught.value) == "The pickup location could not be resolved."
    assert client.queries == ["Current query", "Pickup query"]
    client.route.assert_not_called()
    assert Trip.objects.count() == 0


@pytest.mark.django_db
def test_provider_failure_is_sanitized_and_stores_nothing(
    trip_creation_values,
):
    secret = "upstream body with server-secret"

    class FailingClient:
        def geocode(self, query):
            raise ProviderError(secret)

    with pytest.raises(TripCreationError) as caught:
        create_trip(
            trip_creation_values["validated"],
            client=FailingClient(),
            clock=datetime.now,
        )

    assert caught.value.category == "provider"
    assert caught.value.field is None
    assert str(caught.value) == "The routing service is unavailable."
    assert secret not in str(caught.value)
    assert Trip.objects.count() == 0


@pytest.mark.django_db
@pytest.mark.parametrize(
    "stage",
    ["route", "simulate", "resolve", "split", "snapshot", "insert"],
)
def test_every_preinsert_or_insert_failure_leaves_no_trip(
    stage, monkeypatch, trip_creation_values
):
    from trips.services import trip_creation

    values = trip_creation_values

    class Client:
        def __init__(self):
            self.location_index = 0

        def geocode(self, query):
            location = values["locations"][self.location_index]
            self.location_index += 1
            return location

        def route(self, locations):
            if stage == "route":
                raise ProviderError("raw provider detail")
            return values["route"]

    target = {
        "simulate": "simulate",
        "resolve": "resolve_stops",
        "split": "split",
        "snapshot": "build_snapshot",
    }.get(stage)
    if target:
        monkeypatch.setattr(
            trip_creation,
            target,
            Mock(side_effect=RuntimeError(f"{stage} failed")),
        )
    if stage == "insert":
        monkeypatch.setattr(
            Trip.objects,
            "create",
            Mock(side_effect=RuntimeError("insert failed")),
        )

    with pytest.raises((TripCreationError, RuntimeError)):
        create_trip(
            values["validated"],
            client=Client(),
            clock=lambda: datetime(2026, 7, 18),
        )

    assert Trip.objects.count() == 0
