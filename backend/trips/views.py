"""Thin create-once and stored-only trip API views."""

import hashlib
import logging

from django.conf import settings
from django.core.cache import cache
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from trips.models import Trip
from trips.serializers import (
    LocationSearchQuerySerializer,
    ProviderUnavailable,
    RouteNotResolvable,
    TripCreateSerializer,
    TripDetailSerializer,
)
from trips.services.ors_client import ORSClient, ProviderError
from trips.services.trip_creation import TripCreationError, create_trip


_LOCATION_FIELDS = {
    "current_location",
    "pickup_location",
    "dropoff_location",
}
_LOCATION_SEARCH_CACHE_SECONDS = 15 * 60
logger = logging.getLogger(__name__)


def _ors_client():
    return ORSClient(
        api_key=settings.ORS_API_KEY,
        connect_timeout=settings.ORS_CONNECT_TIMEOUT_SECONDS,
        read_timeout=settings.ORS_READ_TIMEOUT_SECONDS,
        max_retries=settings.ORS_MAX_RETRIES,
    )


class LocationSearchView(APIView):
    """Proxy bounded, cached location suggestions through Django."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "location_search"

    def get(self, request):
        serializer = LocationSearchQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        query = serializer.validated_data["q"]
        digest = hashlib.sha256(query.casefold().encode("utf-8")).hexdigest()
        cache_key = f"location-search:v1:{digest}"
        results = cache.get(cache_key)

        if results is None:
            try:
                matches = _ors_client().search(query, limit=5)
            except (ProviderError, ValueError):
                raise ProviderUnavailable() from None
            results = [
                {
                    "label": match.display_label,
                    "coordinate": [match.longitude, match.latitude],
                }
                for match in matches
            ]
            cache.set(
                cache_key,
                results,
                timeout=_LOCATION_SEARCH_CACHE_SECONDS,
            )

        return Response({"results": results})


class TripCreateView(APIView):
    """Validate and execute the compute-once creation service."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "trip_create"

    def post(self, request):
        serializer = TripCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            trip = create_trip(serializer.validated_data)
        except TripCreationError as error:
            if (
                error.category == "unresolved_location"
                and error.field in _LOCATION_FIELDS
            ):
                raise serializers.ValidationError(
                    {error.field: [str(error)]}
                ) from None
            if error.category == "unroutable":
                raise RouteNotResolvable() from None
            raise ProviderUnavailable() from None
        except Exception as error:
            logger.error(
                "Unexpected trip creation failure (%s).",
                type(error).__name__,
            )
            raise ProviderUnavailable() from None

        return Response(
            TripDetailSerializer(trip).data,
            status=status.HTTP_201_CREATED,
        )


class TripDetailView(APIView):
    """Retrieve a complete persisted snapshot without recomputation."""

    def get(self, request, trip_id):
        trip = get_object_or_404(Trip, pk=trip_id)
        return Response(TripDetailSerializer(trip).data)
