"""Stable request and persisted-response representations for trip HTTP APIs."""

import math

from rest_framework import serializers
from rest_framework.exceptions import APIException


LOCATION_MAX_LENGTH = 200
LOCATION_SEARCH_MIN_LENGTH = 3


class ProviderUnavailable(APIException):
    """Secret-safe public response for provider and creation failures."""

    status_code = 503
    default_detail = {
        "detail": "The routing service is temporarily unavailable."
    }
    default_code = "provider_unavailable"


class RouteNotResolvable(APIException):
    """Secret-safe 400 when the entered locations cannot be routed.

    Distinct from a provider outage (503): the service is up, but no drivable
    route exists for the given locations, so the user should refine them.
    """

    status_code = 400
    default_detail = {
        "detail": (
            "We couldn't find a drivable route between these locations. "
            "Try more specific cities or street addresses."
        )
    }
    default_code = "route_not_resolvable"


class FiniteCycleHoursField(serializers.FloatField):
    """Accept a real finite number inside the locked 70-hour cycle range."""

    def to_internal_value(self, data):
        if isinstance(data, bool):
            self.fail("invalid")
        value = super().to_internal_value(data)
        if not math.isfinite(value):
            self.fail("invalid")
        return value


class TripCreateSerializer(serializers.Serializer):
    """Validate all public input before routing or persistence begins."""

    current_location = serializers.CharField(
        max_length=LOCATION_MAX_LENGTH,
        trim_whitespace=True,
        allow_blank=False,
    )
    pickup_location = serializers.CharField(
        max_length=LOCATION_MAX_LENGTH,
        trim_whitespace=True,
        allow_blank=False,
    )
    dropoff_location = serializers.CharField(
        max_length=LOCATION_MAX_LENGTH,
        trim_whitespace=True,
        allow_blank=False,
    )
    cycle_hours_used = FiniteCycleHoursField(min_value=0, max_value=70)


class LocationSearchQuerySerializer(serializers.Serializer):
    """Bound public autocomplete input before any provider request."""

    q = serializers.CharField(
        min_length=LOCATION_SEARCH_MIN_LENGTH,
        max_length=LOCATION_MAX_LENGTH,
        trim_whitespace=True,
        allow_blank=False,
    )


class TripDetailSerializer(serializers.Serializer):
    """Return the complete stored result without deriving any new values."""

    def to_representation(self, instance):
        return instance.result_snapshot
