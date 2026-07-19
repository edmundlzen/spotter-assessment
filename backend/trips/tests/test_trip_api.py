"""Public create/retrieve API contract."""

import uuid
from unittest.mock import patch

import pytest

from trips.models import Trip
from trips.services.trip_creation import TripCreationError


VALID_INPUT = {
    "current_location": "  Chicago, IL  ",
    "pickup_location": "Gary, IN",
    "dropoff_location": "Indianapolis, IN",
    "cycle_hours_used": 12.5,
}


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("current_location", ""),
        ("pickup_location", "x" * 201),
        ("dropoff_location", "   "),
        ("cycle_hours_used", 70.01),
        ("cycle_hours_used", "NaN"),
    ],
)
def test_invalid_post_is_field_keyed_and_stops_before_creation(client, field, value):
    with patch("trips.views.create_trip") as create:
        response = client.post(
            "/api/trips/",
            {**VALID_INPUT, field: value},
            content_type="application/json",
        )

    assert response.status_code == 400
    assert set(response.json()) == {field}
    create.assert_not_called()


@pytest.mark.django_db
def test_post_creates_once_and_returns_complete_persisted_snapshot(client):
    trip_id = uuid.uuid4()
    snapshot = {
        "schema_version": 1,
        "trip": {"id": str(trip_id)},
        "summary": {"total_distance_miles": 123.456},
    }

    def persist(validated):
        assert validated == {
            "current_location": "Chicago, IL",
            "pickup_location": "Gary, IN",
            "dropoff_location": "Indianapolis, IN",
            "cycle_hours_used": 12.5,
        }
        return Trip.objects.create(id=trip_id, result_snapshot=snapshot)

    with patch("trips.views.create_trip", side_effect=persist) as create:
        response = client.post(
            "/api/trips/",
            VALID_INPUT,
            content_type="application/json",
        )

    assert response.status_code == 201
    assert response.json() == snapshot
    assert client.get(f"/api/trips/{trip_id}/").json()["trip"]["id"] == str(trip_id)
    create.assert_called_once()


@pytest.mark.django_db
def test_unroutable_locations_return_a_clear_400_not_a_generic_503(client):
    error = TripCreationError(
        "The entered locations could not be routed.",
        category="unroutable",
    )

    with patch("trips.views.create_trip", side_effect=error):
        response = client.post(
            "/api/trips/",
            VALID_INPUT,
            content_type="application/json",
        )

    assert response.status_code == 400
    assert "drivable route" in response.json()["detail"]
    assert Trip.objects.count() == 0


@pytest.mark.django_db
def test_unknown_uuid_returns_404(client):
    response = client.get(f"/api/trips/{uuid.uuid4()}/")

    assert response.status_code == 404
