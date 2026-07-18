"""Public create/retrieve API contract and stored-only retrieval proofs."""

from decimal import Decimal
import json
from pathlib import Path
import uuid
from unittest.mock import patch

import pytest
from django.urls import NoReverseMatch, reverse

from trips.models import Trip
from trips.serializers import (
    ProviderUnavailable,
    TripCreateSerializer,
    TripDetailSerializer,
    TripSummarySerializer,
)
from trips.services.trip_creation import TripCreationError


VALID_INPUT = {
    "current_location": "  Chicago, IL  ",
    "pickup_location": "Gary, IN",
    "dropoff_location": "Indianapolis, IN",
    "cycle_hours_used": 12.5,
}


@pytest.mark.parametrize("field", [
    "current_location",
    "pickup_location",
    "dropoff_location",
])
@pytest.mark.parametrize("value", ["", "   ", "x" * 201])
def test_location_validation_is_required_trimmed_nonblank_and_bounded(field, value):
    payload = {**VALID_INPUT, field: value}

    serializer = TripCreateSerializer(data=payload)

    assert not serializer.is_valid()
    assert set(serializer.errors) == {field}


@pytest.mark.parametrize("field", [
    "current_location",
    "pickup_location",
    "dropoff_location",
])
def test_location_validation_requires_every_field(field):
    payload = {**VALID_INPUT}
    del payload[field]

    serializer = TripCreateSerializer(data=payload)

    assert not serializer.is_valid()
    assert set(serializer.errors) == {field}


def test_location_validation_trims_accepted_values():
    serializer = TripCreateSerializer(data=VALID_INPUT)

    assert serializer.is_valid(), serializer.errors
    assert serializer.validated_data["current_location"] == "Chicago, IL"


@pytest.mark.parametrize("value", [0, 70, 12.5])
def test_cycle_hours_validation_accepts_inclusive_finite_range(value):
    serializer = TripCreateSerializer(
        data={**VALID_INPUT, "cycle_hours_used": value}
    )

    assert serializer.is_valid(), serializer.errors
    assert serializer.validated_data["cycle_hours_used"] == value


@pytest.mark.parametrize(
    "value",
    [-0.01, 70.01, float("nan"), float("inf"), float("-inf"), True],
)
def test_cycle_hours_validation_rejects_out_of_range_nonfinite_and_boolean(value):
    serializer = TripCreateSerializer(
        data={**VALID_INPUT, "cycle_hours_used": value}
    )

    assert not serializer.is_valid()
    assert set(serializer.errors) == {"cycle_hours_used"}


@pytest.mark.django_db
def test_summary_serializer_returns_stable_compact_persisted_facts():
    trip_id = uuid.uuid4()
    trip = Trip.objects.create(
        id=trip_id,
        total_distance_miles=Decimal("123.456"),
        total_duration_minutes=789,
        leg_count=2,
        stop_count=3,
        duty_segment_count=4,
        log_day_count=5,
        result_snapshot={"trip": {"id": str(trip_id)}},
    )

    assert TripSummarySerializer(trip).data == {
        "id": str(trip_id),
        "summary": {
            "total_distance_miles": 123.456,
            "total_duration_minutes": 789,
            "leg_count": 2,
            "stop_count": 3,
            "duty_segment_count": 4,
            "log_day_count": 5,
        },
    }


@pytest.mark.django_db
def test_detail_serializer_returns_only_the_complete_stored_snapshot():
    trip_id = uuid.uuid4()
    sentinel = {
        "schema_version": 1,
        "trip": {"id": str(trip_id)},
        "sentinel": ["stored", {"without": "recompute"}],
    }
    trip = Trip.objects.create(
        id=trip_id,
        total_distance_miles=Decimal("1.000"),
        total_duration_minutes=1,
        leg_count=2,
        stop_count=0,
        duty_segment_count=1,
        log_day_count=1,
        result_snapshot=sentinel,
    )

    assert TripDetailSerializer(trip).data == sentinel


def test_provider_unavailable_exception_has_only_a_stable_public_message():
    exception = ProviderUnavailable()

    assert exception.status_code == 503
    assert exception.detail == {
        "detail": "The routing service is temporarily unavailable."
    }
    rendered = str(exception.detail)
    assert not any(
        secret in rendered
        for secret in (
            "api.openrouteservice.org",
            "super-secret-key",
            "Authorization",
            "raw upstream body",
            "Traceback",
            "database connection failed",
        )
    )


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
def test_post_creates_once_and_returns_matching_persisted_identity(client):
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
        return Trip.objects.create(
            id=trip_id,
            total_distance_miles=Decimal("123.456"),
            total_duration_minutes=789,
            leg_count=2,
            stop_count=3,
            duty_segment_count=4,
            log_day_count=5,
            result_snapshot=snapshot,
        )

    with patch("trips.views.create_trip", side_effect=persist) as create:
        response = client.post(
            "/api/trips/",
            VALID_INPUT,
            content_type="application/json",
        )

    assert response.status_code == 201
    assert response.json() == {
        "id": str(trip_id),
        "summary": {
            "total_distance_miles": 123.456,
            "total_duration_minutes": 789,
            "leg_count": 2,
            "stop_count": 3,
            "duty_segment_count": 4,
            "log_day_count": 5,
        },
    }
    assert Trip.objects.get().pk == trip_id
    assert client.get(f"/api/trips/{trip_id}/").json()["trip"]["id"] == str(
        trip_id
    )
    create.assert_called_once()


@pytest.mark.django_db
def test_unresolved_location_is_a_field_specific_sanitized_400(client):
    error = TripCreationError(
        "The pickup location could not be resolved.",
        category="unresolved_location",
        field="pickup_location",
    )

    with patch("trips.views.create_trip", side_effect=error):
        response = client.post(
            "/api/trips/",
            VALID_INPUT,
            content_type="application/json",
        )

    assert response.status_code == 400
    assert response.json() == {
        "pickup_location": ["The pickup location could not be resolved."]
    }
    assert Trip.objects.count() == 0


@pytest.mark.django_db
@pytest.mark.parametrize(
    "error",
    [
        TripCreationError(
            "The routing service is unavailable.",
            category="provider",
        ),
        RuntimeError(
            "database connection failed: api.openrouteservice.org "
            "Authorization=super-secret-key raw upstream body"
        ),
    ],
)
def test_creation_failures_return_generic_503_without_internals(client, error):
    with patch("trips.views.create_trip", side_effect=error):
        response = client.post(
            "/api/trips/",
            VALID_INPUT,
            content_type="application/json",
        )

    assert response.status_code == 503
    assert response.json() == {
        "detail": "The routing service is temporarily unavailable."
    }
    assert Trip.objects.count() == 0
    rendered = response.content.decode()
    assert not any(
        secret in rendered
        for secret in (
            "api.openrouteservice.org",
            "super-secret-key",
            "Authorization",
            "raw upstream body",
            "Traceback",
            "database connection failed",
        )
    )


@pytest.mark.django_db
def test_unexpected_creation_failure_is_logged_without_exception_details(
    client, caplog
):
    secret = "Authorization=super-secret-key"

    with (
        patch(
            "trips.views.create_trip",
            side_effect=RuntimeError(secret),
        ),
        caplog.at_level("ERROR", logger="trips.views"),
    ):
        response = client.post(
            "/api/trips/",
            VALID_INPUT,
            content_type="application/json",
        )

    assert response.status_code == 503
    assert "Unexpected trip creation failure (RuntimeError)." in caplog.text
    assert secret not in caplog.text


@pytest.mark.django_db
def test_detail_get_returns_exact_stored_json_with_every_compute_seam_forbidden(
    client,
):
    trip_id = uuid.uuid4()
    sentinel = {
        "schema_version": 1,
        "trip": {"id": str(trip_id)},
        "route": {"geometry": {"type": "LineString", "coordinates": []}},
        "stops": [],
        "duty_segments": [{"sentinel": True}],
        "log_days": [],
    }
    Trip.objects.create(
        id=trip_id,
        total_distance_miles=Decimal("1.000"),
        total_duration_minutes=1,
        leg_count=2,
        stop_count=0,
        duty_segment_count=1,
        log_day_count=1,
        result_snapshot=sentinel,
    )
    forbidden = AssertionError("stored GET attempted recomputation")

    with (
        patch("trips.views.create_trip", side_effect=forbidden) as create,
        patch(
            "trips.services.ors_client.ORSClient",
            side_effect=forbidden,
        ) as provider,
        patch(
            "trips.hos_engine.engine.simulate",
            side_effect=forbidden,
        ) as simulate,
        patch(
            "trips.services.route_geometry.resolve_stops",
            side_effect=forbidden,
        ) as resolve,
        patch(
            "trips.hos_engine.log_day_builder.split",
            side_effect=forbidden,
        ) as split,
    ):
        response = client.get(f"/api/trips/{trip_id}/")

    assert response.status_code == 200
    assert response.json() == sentinel
    assert response.content == json.dumps(
        sentinel, separators=(",", ":")
    ).encode()
    for seam in (create, provider, simulate, resolve, split):
        seam.assert_not_called()


@pytest.mark.django_db
def test_unknown_uuid_returns_404(client):
    response = client.get(f"/api/trips/{uuid.uuid4()}/")

    assert response.status_code == 404


@pytest.mark.django_db
@pytest.mark.parametrize("method", ["get", "put", "patch", "delete"])
def test_collection_rejects_every_method_except_post(client, method):
    response = getattr(client, method)("/api/trips/")

    assert response.status_code == 405


@pytest.mark.django_db
@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_detail_rejects_every_method_except_get(client, method):
    trip_id = uuid.uuid4()
    response = getattr(client, method)(f"/api/trips/{trip_id}/")

    assert response.status_code == 405


def test_only_create_and_detail_trip_url_names_exist():
    assert reverse("trips:create") == "/api/trips/"
    trip_id = uuid.uuid4()
    assert reverse("trips:detail", kwargs={"trip_id": trip_id}) == (
        f"/api/trips/{trip_id}/"
    )

    for forbidden_name in ("list", "update", "delete", "recompute"):
        with pytest.raises(NoReverseMatch):
            reverse(f"trips:{forbidden_name}")


def test_trip_api_source_has_no_crud_or_recompute_view_surface():
    backend_root = Path(__file__).parents[2]
    source = "\n".join(
        (backend_root / relative).read_text(encoding="utf-8")
        for relative in ("trips/views.py", "trips/urls.py")
    )

    for forbidden in (
        "TripListView",
        "TripUpdateView",
        "TripDeleteView",
        "TripRecomputeView",
        "def put(",
        "def patch(",
        "def delete(",
    ):
        assert forbidden not in source
