from dataclasses import dataclass
from datetime import date, datetime
from enum import Enum


class DutyStatus(Enum):
    """The four FMCSA duty-status rows.

    SLEEPER_BERTH is a valid status but is deliberately never emitted by the
    engine: both the 10h reset and the 34h restart render on the OFF_DUTY row.
    It remains in the enum so a driver could be modeled there later without a
    breaking type change.
    """
    OFF_DUTY = "off_duty"
    SLEEPER_BERTH = "sleeper_berth"
    DRIVING = "driving"
    ON_DUTY_NOT_DRIVING = "on_duty_not_driving"


@dataclass(frozen=True)
class Leg:
    """One leg of the trip: a distance covered over a duration.

    Validation here is a correctness safety net for every caller. A malformed
    upstream value fails loudly with ValueError instead of silently producing
    an invalid HOS schedule.
    """
    distance_miles: float
    duration_hours: float

    def __post_init__(self):
        if self.distance_miles < 0:
            raise ValueError(
                f"Leg.distance_miles must be non-negative, got {self.distance_miles!r}"
            )
        if self.duration_hours <= 0:
            raise ValueError(
                f"Leg.duration_hours must be positive, got {self.duration_hours!r}"
            )
        if self.duration_hours == 0 and self.distance_miles > 0:
            raise ValueError(
                "Leg cannot have zero duration_hours with nonzero distance_miles"
            )


@dataclass(frozen=True)
class DutySegment:
    """A single contiguous block of one duty status."""
    status: DutyStatus
    start: datetime
    end: datetime
    note: str = ""

    @property
    def duration_minutes(self) -> int:
        """Whole minutes between start and end, as an exact int (no float drift)."""
        return int((self.end - self.start).total_seconds() // 60)


@dataclass(frozen=True)
class Stop:
    """A named event (fuel/pickup/dropoff/rest/reset) tied to a duty segment."""
    kind: str
    cumulative_miles: float
    segment: DutySegment


@dataclass(frozen=True)
class TripSchedule:
    """The engine's full output: a flat, time-ordered timeline."""
    segments: list[DutySegment]
    stops: list[Stop]


@dataclass(frozen=True)
class LogDay:
    """One calendar day's worth of duty segments."""
    date: date
    segments: list[DutySegment]
