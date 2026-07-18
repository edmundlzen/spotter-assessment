"""Golden and project-assumption tests for the pure HOS simulation engine."""
from datetime import datetime, timedelta

import pytest

from trips.hos_engine.engine import _Simulation, simulate
from trips.hos_engine.models import DutyStatus, Leg
from trips.hos_engine.rules import (
    BREAK_DURATION_MIN,
    BREAK_TRIGGER_MIN,
    CYCLE_LIMIT_MIN,
    DRIVE_LIMIT_MIN,
    RESTART_MIN,
)


def _segments(schedule, status):
    return [segment for segment in schedule.segments if segment.status == status]


def _stops(schedule, kind):
    return [stop for stop in schedule.stops if stop.kind == kind]


def test_gc1_eleven_hour_driving_limit(base_start_datetime, single_short_leg):
    schedule = simulate([single_short_leg], 0, base_start_datetime)
    driving = _segments(schedule, DutyStatus.DRIVING)

    assert sum(segment.duration_minutes for segment in driving) == DRIVE_LIMIT_MIN
    assert max(segment.duration_minutes for segment in driving) <= BREAK_TRIGGER_MIN
    assert driving[-1].end == datetime(2026, 1, 1, 18, 30)
    assert all(segment.end <= base_start_datetime + timedelta(hours=14) for segment in driving)


def test_gc2_fourteen_hour_window_deadline(base_start_datetime, synthetic_low_speed_leg):
    # The synthetic leg plus a long qualifying pickup isolates the fixed window:
    # pickup consumes four window hours, so the 14h gate binds before 11h driving.
    schedule = simulate(
        [synthetic_low_speed_leg], 0, base_start_datetime, pickup_hours=4
    )
    driving = _segments(schedule, DutyStatus.DRIVING)
    deadline = base_start_datetime + timedelta(hours=14)
    segment_ending_at_deadline = next(segment for segment in driving if segment.end == deadline)
    reset = next(stop.segment for stop in schedule.stops if stop.kind == "reset")
    next_drive = next(segment for segment in driving if segment.start > segment_ending_at_deadline.end)

    assert segment_ending_at_deadline.end == deadline
    assert reset.start == deadline
    assert reset.duration_minutes >= 10 * 60
    assert next_drive.start >= reset.end


def test_gc3_thirty_four_hour_restart(base_start_datetime):
    schedule = simulate([Leg(100, 2)], 68, base_start_datetime)
    restart = _stops(schedule, "restart")[0]
    later_driving = [
        segment
        for segment in _segments(schedule, DutyStatus.DRIVING)
        if segment.start >= restart.segment.end
    ]

    assert restart.segment.status == DutyStatus.OFF_DUTY
    assert restart.segment.duration_minutes == RESTART_MIN
    assert later_driving

    state = _Simulation(base_start_datetime, 68)
    state.emit_on_duty_stop(60, "pickup")
    state._emit(DutyStatus.DRIVING, 60)
    state._insert_restart()
    assert state.cycle_remaining_min == CYCLE_LIMIT_MIN
    assert state.drive_accum_min == 0
    assert state.drive_since_break_min == 0


def test_gc4_ten_hour_reset(base_start_datetime, multiday_legs):
    schedule = simulate(multiday_legs, 0, base_start_datetime)
    reset = _stops(schedule, "reset")[0].segment
    next_drive = next(
        segment
        for segment in _segments(schedule, DutyStatus.DRIVING)
        if segment.start >= reset.end
    )

    assert reset.status == DutyStatus.OFF_DUTY
    assert reset.duration_minutes == 10 * 60
    assert next_drive.start == reset.end

    state = _Simulation(base_start_datetime, 0)
    state.emit_on_duty_stop(60, "pickup")
    state._emit(DutyStatus.DRIVING, 60)
    remaining_before_reset = state.cycle_remaining_min
    state._insert_reset()
    assert state.window_deadline == state.now + timedelta(hours=14)
    assert state.drive_accum_min == 0
    assert state.drive_since_break_min == 0
    assert state.cycle_remaining_min == remaining_before_reset


def test_break_credit_no_duplicate(base_start_datetime):
    schedule = simulate([Leg(500, 10)], 0, base_start_datetime)
    fuel = _stops(schedule, "fuel")
    breaks = _stops(schedule, "break")

    # Project stop: fuel at 8h driving is already a qualifying 30-minute block.
    assert len(fuel) == 0
    assert len(breaks) == 1
    break_index = schedule.segments.index(breaks[0].segment)
    assert schedule.segments[break_index + 1].status == DutyStatus.DRIVING


# Project-assumption test: fuel cadence comes from the assessment brief.
@pytest.mark.parametrize("miles", [999, 1000, 2000])
def test_fuel_stop_cadence(base_start_datetime, miles):
    schedule = simulate([Leg(miles, miles / 50)], 0, base_start_datetime)
    fuel_stops = _stops(schedule, "fuel")

    assert len(fuel_stops) == miles // 1000
    assert [round(stop.cumulative_miles, 6) for stop in fuel_stops] == [
        float(threshold) for threshold in range(1000, miles + 1, 1000)
    ]
    assert all(stop.segment.status == DutyStatus.ON_DUTY_NOT_DRIVING for stop in fuel_stops)
    assert all(stop.segment.duration_minutes == BREAK_DURATION_MIN for stop in fuel_stops)


# Project-assumption test: a threshold within 60 minutes of hour 8 is combined.
def test_fuel_break_combination_within_window(base_start_datetime):
    schedule = simulate([Leg(1000, 7.5)], 0, base_start_datetime)

    assert len(_stops(schedule, "fuel")) == 1
    assert not _stops(schedule, "break")
    assert "doubling" in _stops(schedule, "fuel")[0].segment.note


# Project-assumption test: a later fuel threshold remains independent.
def test_fuel_break_combination_outside_window(base_start_datetime):
    schedule = simulate([Leg(1000, 10)], 0, base_start_datetime)

    assert len(_stops(schedule, "fuel")) == 1
    assert len(_stops(schedule, "break")) == 1
    assert _stops(schedule, "break")[0].segment.end <= _stops(schedule, "fuel")[0].segment.start


# Project-assumption test: pickup/dropoff are one-hour ODND blocks.
def test_pickup_dropoff_duration_and_window_consumption(base_start_datetime):
    schedule = simulate([Leg(100, 2)], 0, base_start_datetime)
    pickup = _stops(schedule, "pickup")[0].segment
    dropoff = _stops(schedule, "dropoff")[0].segment
    driving = _segments(schedule, DutyStatus.DRIVING)

    assert pickup.status == DutyStatus.ON_DUTY_NOT_DRIVING
    assert pickup.duration_minutes == 60
    assert pickup.start == base_start_datetime
    assert driving[0].start == pickup.end
    assert dropoff.status == DutyStatus.ON_DUTY_NOT_DRIVING
    assert dropoff.duration_minutes == 60
    assert dropoff.start == driving[-1].end


def test_pickup_after_first_leg_preserves_order_duration_and_mileage(base_start_datetime):
    schedule = simulate(
        [Leg(100, 2), Leg(200, 4)],
        0,
        base_start_datetime,
        pickup_after_leg=1,
    )
    pickup = _stops(schedule, "pickup")[0]
    dropoff = _stops(schedule, "dropoff")[0]

    assert schedule.segments[0].status == DutyStatus.DRIVING
    assert schedule.segments[0].duration_minutes == 120
    assert schedule.segments[1] == pickup.segment
    assert pickup.segment.status == DutyStatus.ON_DUTY_NOT_DRIVING
    assert pickup.segment.duration_minutes == 60
    assert pickup.cumulative_miles == pytest.approx(100.0)
    assert dropoff.cumulative_miles == pytest.approx(300.0)


def test_pickup_after_leg_defaults_to_before_route(base_start_datetime):
    schedule = simulate([Leg(100, 2), Leg(200, 4)], 0, base_start_datetime)
    pickup = _stops(schedule, "pickup")[0]

    assert schedule.segments[0] == pickup.segment
    assert pickup.cumulative_miles == pytest.approx(0.0)


@pytest.mark.parametrize("leading_leg_count", [-1, 3])
def test_invalid_leading_leg_count_fails_before_driving(
    leading_leg_count, base_start_datetime, monkeypatch
):
    def fail_if_driven(*args, **kwargs):
        raise AssertionError("invalid pickup_after_leg must fail before driving")

    monkeypatch.setattr(_Simulation, "drive_leg", fail_if_driven)

    with pytest.raises(ValueError, match="pickup_after_leg"):
        simulate(
            [Leg(100, 2), Leg(200, 4)],
            0,
            base_start_datetime,
            pickup_after_leg=leading_leg_count,
        )


# Project-assumption test: the cycle uses the documented linear decrement.
def test_cycle_linear_decrement_formula(base_start_datetime):
    state = _Simulation(base_start_datetime, 10)
    state.emit_on_duty_stop(60, "pickup")
    state._emit(DutyStatus.DRIVING, 120)
    state.emit_on_duty_stop(60, "dropoff")

    assert state.cycle_remaining_min == CYCLE_LIMIT_MIN - 10 * 60 - 240


# Project-assumption test: reset/restart markers always render on Off Duty.
def test_reset_restart_render_off_duty(base_start_datetime, multiday_legs):
    reset_schedule = simulate(multiday_legs, 0, base_start_datetime)
    restart_schedule = simulate([Leg(100, 2)], 68, base_start_datetime)
    resets = [
        stop for schedule in (reset_schedule, restart_schedule)
        for stop in schedule.stops if stop.kind in {"reset", "restart"}
    ]

    assert resets
    assert all(stop.segment.status == DutyStatus.OFF_DUTY for stop in resets)
    assert all(stop.segment.status != DutyStatus.SLEEPER_BERTH for stop in resets)


def test_determinism(base_start_datetime, multiday_legs):
    args = (multiday_legs, 12.5, base_start_datetime)
    assert simulate(*args) == simulate(*args)


@pytest.mark.parametrize("cycle_hours_used", [-0.01, 70.01])
def test_cycle_hours_used_out_of_range(cycle_hours_used, base_start_datetime):
    with pytest.raises(ValueError):
        simulate([], cycle_hours_used, base_start_datetime)
