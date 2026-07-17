"""Universal HOS invariants across representative generated trips."""
from dataclasses import dataclass
from datetime import datetime, timedelta

import pytest

from trips.hos_engine.engine import simulate
from trips.hos_engine.log_day_builder import split
from trips.hos_engine.models import DutyStatus, Leg
from trips.hos_engine.rules import (
    BREAK_DURATION_MIN,
    BREAK_TRIGGER_MIN,
    CYCLE_LIMIT_MIN,
    DRIVE_LIMIT_MIN,
    RESTART_MIN,
    RESET_MIN,
    WINDOW_LIMIT_MIN,
)


@dataclass(frozen=True)
class TripCase:
    name: str
    legs: tuple[Leg, ...]
    cycle_hours_used: float = 0
    pickup_hours: float = 1
    dropoff_hours: float = 1


CASES = [
    TripCase("short", (Leg(100, 2),)),
    TripCase("multi_day_fuel", (Leg(1200, 24),)),
    TripCase("high_cycle_restart", (Leg(200, 4),), cycle_hours_used=68),
    TripCase(
        "window_bound",
        (Leg(75, 15),),
        pickup_hours=4,
    ),
]


@pytest.fixture(params=CASES, ids=lambda case: case.name)
def generated_trip(request, base_start_datetime):
    case = request.param
    schedule = simulate(
        case.legs,
        case.cycle_hours_used,
        base_start_datetime,
        pickup_hours=case.pickup_hours,
        dropoff_hours=case.dropoff_hours,
    )
    return case, base_start_datetime, schedule


def test_every_generated_trip_sums_to_1440(generated_trip):
    _, _, schedule = generated_trip
    days = split(schedule.segments)

    assert days
    assert all(
        sum(segment.duration_minutes for segment in day.segments) == 1440
        for day in days
    )


def test_no_hos_limit_ever_exceeded(generated_trip):
    case, start, schedule = generated_trip
    shift_start = start
    window_deadline = shift_start + timedelta(minutes=WINDOW_LIMIT_MIN)
    drive_accum_min = 0
    drive_since_break_min = 0
    cycle_remaining_min = CYCLE_LIMIT_MIN - round(case.cycle_hours_used * 60)

    for segment in schedule.segments:
        minutes = segment.duration_minutes

        if segment.status == DutyStatus.DRIVING:
            assert segment.start < window_deadline
            assert segment.end <= window_deadline
            assert drive_accum_min + minutes <= DRIVE_LIMIT_MIN
            assert drive_since_break_min < BREAK_TRIGGER_MIN
            assert drive_since_break_min + minutes <= BREAK_TRIGGER_MIN
            drive_accum_min += minutes
            drive_since_break_min += minutes
            cycle_remaining_min -= minutes
        elif segment.status == DutyStatus.ON_DUTY_NOT_DRIVING:
            cycle_remaining_min -= minutes
            if minutes >= BREAK_DURATION_MIN:
                drive_since_break_min = 0
        else:
            if minutes >= BREAK_DURATION_MIN:
                drive_since_break_min = 0
            if minutes >= RESET_MIN:
                drive_accum_min = 0
                shift_start = segment.end
                window_deadline = shift_start + timedelta(minutes=WINDOW_LIMIT_MIN)
            if minutes >= RESTART_MIN:
                cycle_remaining_min = CYCLE_LIMIT_MIN

        assert cycle_remaining_min >= 0


def test_determinism_across_trips(generated_trip):
    case, start, schedule = generated_trip

    repeated = simulate(
        case.legs,
        case.cycle_hours_used,
        start,
        pickup_hours=case.pickup_hours,
        dropoff_hours=case.dropoff_hours,
    )

    assert repeated == schedule
