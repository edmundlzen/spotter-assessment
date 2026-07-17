from datetime import datetime

from trips.hos_engine.models import DutyStatus

DRIVE_LIMIT_MIN = 11 * 60
WINDOW_LIMIT_MIN = 14 * 60
BREAK_TRIGGER_MIN = 8 * 60
BREAK_DURATION_MIN = 30
CYCLE_LIMIT_MIN = 70 * 60
RESET_MIN = 10 * 60
RESTART_MIN = 34 * 60

FUEL_INTERVAL_MILES = 1000
PICKUP_MIN_DEFAULT = 60
DROPOFF_MIN_DEFAULT = 60

FUEL_BREAK_COMBINE_WINDOW_MIN = 60


def driving_is_legal(
    now: datetime,
    window_deadline: datetime,
    drive_accum_min: int,
    drive_since_break_min: int,
) -> bool:
    """True only when all three independent gates are satisfied.

    None of the three gates extends or pauses another (Pitfall 2, HOS-02):
    a fixed wall-clock window deadline, the 11h driving accumulator, and the
    8h-since-last-qualifying-break accumulator are each checked on their own
    terms and AND-ed together.
    """
    return (
        now < window_deadline
        and drive_accum_min < DRIVE_LIMIT_MIN
        and drive_since_break_min < BREAK_TRIGGER_MIN
    )


def satisfies_break(status: DutyStatus, duration_min: int) -> bool:
    """True iff a single contiguous non-driving block of >= 30 minutes.

    FMCSA p.10: "Short, non-consecutive periods cannot be combined to reach
    30 minutes" — fragments never qualify, only one contiguous block does
    (HOS-03).
    """
    return status != DutyStatus.DRIVING and duration_min >= BREAK_DURATION_MIN
