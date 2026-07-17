"""Isolated calendar-day splitting and 1440-minute invariant tests."""
from datetime import datetime

from trips.hos_engine.log_day_builder import split
from trips.hos_engine.models import DutySegment, DutyStatus


def _segment(status, start, end, note=""):
    return DutySegment(status=status, start=start, end=end, note=note)


def _assert_full_days(days):
    assert all(
        sum(segment.duration_minutes for segment in day.segments) == 1440
        for day in days
    )


def test_single_day_no_split():
    start = datetime(2026, 1, 1)
    segments = [
        _segment(DutyStatus.OFF_DUTY, start, datetime(2026, 1, 1, 6)),
        _segment(
            DutyStatus.ON_DUTY_NOT_DRIVING,
            datetime(2026, 1, 1, 6),
            datetime(2026, 1, 1, 7),
        ),
        _segment(
            DutyStatus.DRIVING,
            datetime(2026, 1, 1, 7),
            datetime(2026, 1, 1, 18),
        ),
        _segment(
            DutyStatus.OFF_DUTY,
            datetime(2026, 1, 1, 18),
            datetime(2026, 1, 2),
        ),
    ]

    days = split(segments)

    assert len(days) == 1
    assert days[0].date == start.date()
    assert days[0].segments == segments
    _assert_full_days(days)


def test_midnight_crossing_split():
    segments = [
        _segment(
            DutyStatus.OFF_DUTY,
            datetime(2026, 1, 1),
            datetime(2026, 1, 1, 22),
        ),
        _segment(
            DutyStatus.DRIVING,
            datetime(2026, 1, 1, 22),
            datetime(2026, 1, 2, 2),
            note="continued leg",
        ),
        _segment(
            DutyStatus.OFF_DUTY,
            datetime(2026, 1, 2, 2),
            datetime(2026, 1, 3),
        ),
    ]

    days = split(segments)

    assert len(days) == 2
    assert days[0].segments[-1].end == datetime(2026, 1, 2)
    assert days[1].segments[0].start == datetime(2026, 1, 2)
    assert days[1].segments[0].end == datetime(2026, 1, 2, 2)
    assert days[1].segments[0].status == DutyStatus.DRIVING
    assert days[1].segments[0].note == "continued leg"
    _assert_full_days(days)


def test_every_log_day_sums_to_1440_minutes():
    segments = [
        _segment(
            DutyStatus.OFF_DUTY,
            datetime(2026, 1, 1),
            datetime(2026, 1, 1, 6),
        ),
        _segment(
            DutyStatus.ON_DUTY_NOT_DRIVING,
            datetime(2026, 1, 1, 6),
            datetime(2026, 1, 1, 7),
        ),
        _segment(
            DutyStatus.DRIVING,
            datetime(2026, 1, 1, 7),
            datetime(2026, 1, 2, 5),
        ),
        _segment(
            DutyStatus.OFF_DUTY,
            datetime(2026, 1, 2, 5),
            datetime(2026, 1, 3, 10),
        ),
        _segment(
            DutyStatus.DRIVING,
            datetime(2026, 1, 3, 10),
            datetime(2026, 1, 4),
        ),
    ]

    days = split(segments)

    assert [day.date.isoformat() for day in days] == [
        "2026-01-01",
        "2026-01-02",
        "2026-01-03",
    ]
    _assert_full_days(days)


def test_segment_ending_at_midnight_is_not_double_counted():
    midnight = datetime(2026, 1, 2)
    days = split(
        [
            _segment(DutyStatus.OFF_DUTY, datetime(2026, 1, 1), midnight),
            _segment(DutyStatus.DRIVING, midnight, datetime(2026, 1, 2, 1)),
        ]
    )

    assert len(days[0].segments) == 1
    assert days[0].segments[0].end == midnight
    assert all(segment.start >= midnight for segment in days[1].segments)


def test_empty_timeline_returns_no_days():
    assert split([]) == []
