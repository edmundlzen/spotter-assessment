"""Thin create-once and stored-only trip API views."""

from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from trips.models import Trip
from trips.serializers import (
    ProviderUnavailable,
    TripCreateSerializer,
    TripDetailSerializer,
    TripSummarySerializer,
)
from trips.services.trip_creation import TripCreationError, create_trip


_LOCATION_FIELDS = {
    "current_location",
    "pickup_location",
    "dropoff_location",
}


class TripCreateView(APIView):
    """Validate and execute the compute-once creation service."""

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
            raise ProviderUnavailable() from None
        except Exception:
            raise ProviderUnavailable() from None

        return Response(
            TripSummarySerializer(trip).data,
            status=status.HTTP_201_CREATED,
        )


class TripDetailView(APIView):
    """Retrieve a complete persisted snapshot without recomputation."""

    def get(self, request, trip_id):
        trip = get_object_or_404(Trip, pk=trip_id)
        return Response(TripDetailSerializer(trip).data)
