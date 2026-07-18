"""Compute a complete trip once, then persist its immutable snapshot once."""

from __future__ import annotations

from datetime import datetime, time
import math
import uuid

from django.conf import settings
from django.db import transaction

from trips.hos_engine.engine import simulate
from trips.hos_engine.log_day_builder import split
from trips.hos_engine.models import Leg
from trips.models import Trip
from trips.services.ors_client import ORSClient, ProviderError
from trips.services.route_geometry import METERS_PER_MILE, resolve_stops
from trips.services.snapshot import build_snapshot


_LOCATION_FIELDS = (
    ("current_location", "current"),
    ("pickup_location", "pickup"),
    ("dropoff_location", "dropoff"),
)


class TripCreationError(RuntimeError):
    """A sanitized, categorized failure for the API boundary."""

    def __init__(self, message, *, category, field=None):
        super().__init__(message)
        self.category = category
        self.field = field


def create_trip(validated, *, client=None, clock=None):
    """Resolve, compute, normalize, and atomically insert one complete trip."""
    if client is None:
        client = ORSClient(
            api_key=settings.ORS_API_KEY,
            connect_timeout=settings.ORS_CONNECT_TIMEOUT_SECONDS,
            read_timeout=settings.ORS_READ_TIMEOUT_SECONDS,
            max_retries=settings.ORS_MAX_RETRIES,
        )
    if clock is None:
        clock = _local_now

    locations = []
    try:
        for field, role in _LOCATION_FIELDS:
            location = client.geocode(validated[field])
            if location is None:
                raise TripCreationError(
                    f"The {role} location could not be resolved.",
                    category="unresolved_location",
                    field=field,
                )
            locations.append(location)
        route = client.route(locations)
    except ProviderError:
        raise TripCreationError(
            "The routing service is unavailable.",
            category="provider",
        ) from None

    legs = _engine_legs(route)
    departure = datetime.combine(clock().date(), time(hour=8))
    schedule = simulate(
        legs,
        validated["cycle_hours_used"],
        departure,
        pickup_after_leg=1,
    )
    resolved_stops = resolve_stops(schedule.stops, route)
    log_days = split(schedule.segments)

    trip_id = uuid.uuid4()
    snapshot, summary = build_snapshot(
        trip_id=trip_id,
        validated=validated,
        locations=tuple(locations),
        route=route,
        schedule=schedule,
        resolved_stops=resolved_stops,
        log_days=log_days,
        departure=departure,
    )

    with transaction.atomic():
        trip = Trip.objects.create(
            id=trip_id,
            **summary,
            departure_assumed=True,
            result_snapshot=snapshot,
        )
    return trip


def _engine_legs(route):
    if len(route.legs) != 2:
        raise ValueError("route must contain exactly two legs")
    legs = []
    for route_leg in route.legs:
        distance_miles = route_leg.distance_meters / METERS_PER_MILE
        duration_hours = route_leg.duration_seconds / 3600
        if (
            not math.isfinite(distance_miles)
            or not math.isfinite(duration_hours)
            or distance_miles < 0
            or duration_hours <= 0
        ):
            raise ValueError("route leg units must be finite and positive")
        legs.append(
            Leg(
                distance_miles=distance_miles,
                duration_hours=duration_hours,
            )
        )
    return legs


def _local_now():
    """Return a timezone-naive local wall-clock value for the D-01 date."""
    return datetime.now()
