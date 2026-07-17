"""Shared pytest fixtures for the hos_engine test suite.

Leg-constructing fixtures were deferred from plan 01-01 (Leg didn't exist
yet) and are added here in plan 01-02, now that hos_engine.models exists.
See 01-01-PLAN.md / 01-02-PLAN.md for the rationale.
"""
from datetime import datetime

import pytest

from trips.hos_engine.models import Leg

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
