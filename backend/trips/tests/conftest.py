"""Shared deterministic values for trip and HOS service tests.

Leg-constructing fixtures were deferred from plan 01-01 (Leg didn't exist
yet) and are added here in plan 01-02, now that hos_engine.models exists.
See 01-01-PLAN.md / 01-02-PLAN.md for the rationale.
"""
from datetime import datetime
import uuid

import pytest

from trips.hos_engine.engine import simulate
from trips.hos_engine.log_day_builder import split
from trips.hos_engine.models import Leg
from trips.services.ors_client import (
    ResolvedLocation,
    ResolvedRoute,
    ResolvedRouteLeg,
)
from trips.services.route_geometry import METERS_PER_MILE, resolve_stops

# Default average speed used by tests when synthesizing multi-day legs from a
# mileage figure. This is a TEST-ONLY constant — the engine itself never
# computes speed; it consumes Leg.duration_hours directly.
AVG_SPEED_MPH = 50


@pytest.fixture
def base_start_datetime():
    """A fixed, timezone-naive trip start used across tests (naive local wall-clock, per D-01)."""
    return datetime(2026, 1, 1, 6, 0)


def legs_from_miles(total_miles: float, avg_mph: float = AVG_SPEED_MPH) -> Leg:
    """Build a single Leg covering total_miles at a constant avg_mph.

    Test-only helper — the engine itself never computes speed; it consumes
    Leg.distance_miles / Leg.duration_hours directly.
    """
    return Leg(distance_miles=total_miles, duration_hours=total_miles / avg_mph)


@pytest.fixture
def single_short_leg():
    """A Leg under 1000mi with duration_hours=11.

    Isolates the 11h-driving/30-min-break interaction with no fuel stop
    triggered (GC-1, FMCSA driver's guide p.6).
    """
    return Leg(distance_miles=550, duration_hours=11)


@pytest.fixture
def synthetic_low_speed_leg():
    """A Leg implying ~5mph — a deliberate test-construction device, NOT a
    realistic engine input. Used to push wall-clock time past the 14h window
    deadline while drive_accum_min and drive_since_break_min both stay well
    under their own limits, isolating the window gate (GC-2, RESEARCH.md
    Golden Test Cases / Assumptions Log A2).
    """
    return Leg(distance_miles=75, duration_hours=15)


@pytest.fixture
def multiday_legs():
    """Legs totaling more than one 11h driving day at ~AVG_SPEED_MPH.

    Forces an overnight 10h reset before all driving can complete in a
    single day (GC-4, 10-hour off-duty reset).
    """
    return [legs_from_miles(600), legs_from_miles(600)]


@pytest.fixture
def trip_creation_values():
    """Complete, injected values shared by snapshot and orchestration tests."""
    validated = {
        "current_location": "Current query",
        "pickup_location": "Pickup query",
        "dropoff_location": "Dropoff query",
        "cycle_hours_used": 12.5,
    }
    locations = (
        ResolvedLocation("Current query", "Current label", -87.0, 41.0),
        ResolvedLocation("Pickup query", "Pickup label", -86.99, 41.0),
        ResolvedLocation("Dropoff query", "Dropoff label", -86.97, 41.0),
    )
    route = ResolvedRoute(
        total_meters=3 * METERS_PER_MILE,
        total_seconds=6 * 60 * 60,
        legs=(
            ResolvedRouteLeg(METERS_PER_MILE, 2 * 60 * 60, 0, 2),
            ResolvedRouteLeg(2 * METERS_PER_MILE, 4 * 60 * 60, 2, 4),
        ),
        geometry=(
            (-87.0, 41.0),
            (-86.995, 41.0),
            (-86.99, 41.0),
            (-86.98, 41.0),
            (-86.97, 41.0),
        ),
        waypoint_indices=(0, 2, 4),
    )
    departure = datetime(2026, 7, 18, 8)
    schedule = simulate(
        [Leg(1, 2), Leg(2, 4)],
        validated["cycle_hours_used"],
        departure,
        pickup_after_leg=1,
    )
    resolved_stops = resolve_stops(schedule.stops, route)

    return {
        "trip_id": uuid.UUID("12345678-1234-4abc-9234-1234567890ab"),
        "validated": validated,
        "locations": locations,
        "route": route,
        "schedule": schedule,
        "resolved_stops": resolved_stops,
        "log_days": split(schedule.segments),
        "departure": departure,
        "leg_duration_minutes": (120, 240),
    }
