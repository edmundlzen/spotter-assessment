import math
from datetime import datetime, timedelta

from trips.hos_engine.models import DutySegment, DutyStatus, Stop, TripSchedule
from trips.hos_engine.rules import (
    BREAK_DURATION_MIN,
    BREAK_TRIGGER_MIN,
    CYCLE_LIMIT_MIN,
    DRIVE_LIMIT_MIN,
    FUEL_BREAK_COMBINE_WINDOW_MIN,
    FUEL_INTERVAL_MILES,
    RESET_MIN,
    RESTART_MIN,
    WINDOW_LIMIT_MIN,
    driving_is_legal,
)

FUEL_DURATION_MIN = BREAK_DURATION_MIN


def _whole_minutes(delta: timedelta) -> int:
    """Whole minutes in a timedelta, as an exact int (all boundaries are on whole minutes)."""
    return int(delta.total_seconds() // 60)


class _Simulation:
    """Mutable simulation state. One instance per ``simulate()`` call — never shared,
    never reads ambient state, so the public function stays pure in its arguments."""

    def __init__(self, start_datetime: datetime, cycle_hours_used: float):
        self.now = start_datetime
        self.shift_start = start_datetime
        self.window_deadline = start_datetime + timedelta(minutes=WINDOW_LIMIT_MIN)
        self.drive_accum_min = 0
        self.drive_since_break_min = 0
        self.cycle_remaining_min = CYCLE_LIMIT_MIN - round(cycle_hours_used * 60)
        self.cumulative_miles = 0.0
        self.next_fuel_threshold = float(FUEL_INTERVAL_MILES)
        self.segments: list[DutySegment] = []
        self.stops: list[Stop] = []


    def _emit(self, status: DutyStatus, minutes: int, kind: str | None = None, note: str = "") -> None:
        """Append one duty segment of ``minutes`` and advance every accumulator the
        SAME way for every status (Pitfall 4: stops advance the on-duty clock too)."""
        if minutes <= 0:
            return
        seg = DutySegment(status=status, start=self.now, end=self.now + timedelta(minutes=minutes), note=note)
        self.segments.append(seg)
        if kind is not None:
            self.stops.append(Stop(kind=kind, cumulative_miles=self.cumulative_miles, segment=seg))
        self.now = seg.end

        if status == DutyStatus.DRIVING:
            self.drive_accum_min += minutes
            self.drive_since_break_min += minutes
            self.cycle_remaining_min -= minutes
        elif status == DutyStatus.ON_DUTY_NOT_DRIVING:
            self.cycle_remaining_min -= minutes
            if minutes >= BREAK_DURATION_MIN:
                self.drive_since_break_min = 0
        else:
            if minutes >= BREAK_DURATION_MIN:
                self.drive_since_break_min = 0
            if minutes >= RESET_MIN:
                self.drive_accum_min = 0
                self.shift_start = self.now
                self.window_deadline = self.now + timedelta(minutes=WINDOW_LIMIT_MIN)
            if minutes >= RESTART_MIN:
                self.cycle_remaining_min = CYCLE_LIMIT_MIN


    def _insert_reset(self) -> None:
        """10h off-duty reset — restarts drive/window/break, NOT the cycle (HOS-05, D-03)."""
        self._emit(DutyStatus.OFF_DUTY, RESET_MIN, kind="reset")

    def _insert_restart(self) -> None:
        """34h off-duty restart — restores the full 70h cycle (and, being >=10h, the shift too) (HOS-04, D-03)."""
        self._emit(DutyStatus.OFF_DUTY, RESTART_MIN, kind="restart")

    def _insert_break(self) -> None:
        """Dedicated 30-min off-duty rest break at the 8h mark (HOS-03)."""
        self._emit(DutyStatus.OFF_DUTY, BREAK_DURATION_MIN, kind="break")

    def _ensure_cycle_for(self, minutes_needed: int) -> None:
        """Guarantee the cycle can absorb an upcoming on-duty block without going
        negative — insert a 34h restart first if it cannot (keeps cycle_remaining >= 0)."""
        if self.cycle_remaining_min < minutes_needed:
            self._insert_restart()

    def emit_on_duty_stop(self, minutes: int, kind: str) -> None:
        """Pickup/dropoff: a fixed On-Duty-Not-Driving block that consumes the window
        and the cycle exactly as driving does (HOS-07, Pitfall 4)."""
        if minutes <= 0:
            return
        self._ensure_cycle_for(minutes)
        self._emit(DutyStatus.ON_DUTY_NOT_DRIVING, minutes, kind=kind)

    def emit_fuel(self) -> None:
        """A 30-min ODND fuel stop at the current mileage threshold. Being >=30 min it
        credits the 8h break; when it lands within FUEL_BREAK_COMBINE_WINDOW_MIN of the
        break point it IS the break (D-04) — no separate break is inserted afterwards."""
        self._ensure_cycle_for(FUEL_DURATION_MIN)
        combined = self.drive_since_break_min >= (BREAK_TRIGGER_MIN - FUEL_BREAK_COMBINE_WINDOW_MIN)
        note = "fuel stop doubling as the 30-min break (D-04)" if combined else "fuel stop"
        self._emit(DutyStatus.ON_DUTY_NOT_DRIVING, FUEL_DURATION_MIN, kind="fuel", note=note)
        self.next_fuel_threshold += FUEL_INTERVAL_MILES


    def drive_leg(self, distance_miles: float, duration_hours: float) -> None:
        leg_total_min = round(duration_hours * 60)
        if leg_total_min <= 0:
            return
        miles_per_min = distance_miles / leg_total_min
        driven_in_leg_min = 0

        while driven_in_leg_min < leg_total_min:
            if self.cycle_remaining_min <= 0:
                self._insert_restart()
                continue

            if not driving_is_legal(
                self.now, self.window_deadline, self.drive_accum_min, self.drive_since_break_min
            ):
                if self.now >= self.window_deadline or self.drive_accum_min >= DRIVE_LIMIT_MIN:
                    self._insert_reset()
                else:
                    self._insert_break()
                continue

            mins_to_window = _whole_minutes(self.window_deadline - self.now)
            mins_to_drive_limit = DRIVE_LIMIT_MIN - self.drive_accum_min
            mins_to_break = BREAK_TRIGGER_MIN - self.drive_since_break_min
            mins_to_cycle = self.cycle_remaining_min
            mins_left_in_leg = leg_total_min - driven_in_leg_min
            drivable = min(
                mins_to_window, mins_to_drive_limit, mins_to_break, mins_to_cycle, mins_left_in_leg
            )

            fuel_due = False
            if miles_per_min > 0:
                miles_to_threshold = self.next_fuel_threshold - self.cumulative_miles
                if miles_to_threshold <= 0:
                    fuel_due = True
                    drivable = 0
                else:
                    mins_to_fuel = math.floor(miles_to_threshold / miles_per_min)
                    if mins_to_fuel <= drivable:
                        drivable = mins_to_fuel
                        fuel_due = True

            if drivable > 0:
                self._emit(DutyStatus.DRIVING, drivable)
                self.cumulative_miles += drivable * miles_per_min
                driven_in_leg_min += drivable
            if fuel_due:
                self.emit_fuel()


def simulate(
    legs,
    cycle_hours_used: float,
    start_datetime: datetime,
    pickup_hours: float = 1,
    dropoff_hours: float = 1,
    pickup_after_leg: int = 0,
) -> TripSchedule:
    """Simulate a full property-carrying trip into a deterministic duty-status timeline.

    Args:
        legs: ordered iterable of ``Leg`` (distance_miles, duration_hours).
        cycle_hours_used: on-duty hours already used in the current 70h/8-day cycle, in ``[0, 70]``.
        start_datetime: naive local wall-clock time the driver first comes on duty (D-01/D-02).
        pickup_hours: On-Duty-Not-Driving hours consumed at pickup (default 1h).
        dropoff_hours: On-Duty-Not-Driving hours consumed after the last leg (default 1h).
        pickup_after_leg: number of leading legs driven before pickup. The
            default ``0`` preserves pickup-before-route behavior.

    Returns:
        ``TripSchedule`` — a flat, time-ordered list of ``DutySegment`` plus the
        ``Stop`` markers (pickup/dropoff/fuel/break/reset/restart).

    Raises:
        ValueError: if ``cycle_hours_used`` is outside ``[0, 70]`` or
            ``pickup_after_leg`` is not an integer in the materialized leg range.
            This is V5 defensive validation — a correctness safety net,
            distinct from Phase 5's INPUT-02.
    """
    if not (0 <= cycle_hours_used <= 70):
        raise ValueError(
            f"cycle_hours_used must be within [0, 70], got {cycle_hours_used!r}"
        )

    legs = list(legs)
    if (
        not isinstance(pickup_after_leg, int)
        or isinstance(pickup_after_leg, bool)
        or not 0 <= pickup_after_leg <= len(legs)
    ):
        raise ValueError(
            "pickup_after_leg must be an integer within "
            f"[0, {len(legs)}], got {pickup_after_leg!r}"
        )

    sim = _Simulation(start_datetime, cycle_hours_used)

    if legs:
        for leg in legs[:pickup_after_leg]:
            sim.drive_leg(leg.distance_miles, leg.duration_hours)
        sim.emit_on_duty_stop(round(pickup_hours * 60), kind="pickup")
        for leg in legs[pickup_after_leg:]:
            sim.drive_leg(leg.distance_miles, leg.duration_hours)
        sim.emit_on_duty_stop(round(dropoff_hours * 60), kind="dropoff")

    return TripSchedule(segments=sim.segments, stops=sim.stops)
