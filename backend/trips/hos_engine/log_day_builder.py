"""Split a flat duty timeline into complete timezone-naive local log days."""
from datetime import date, datetime, time, timedelta

from trips.hos_engine.models import DutySegment, DutyStatus, LogDay


def split(segments: list[DutySegment]) -> list[LogDay]:
    """Group segments by local date, cutting midnight-crossing segments.

    Input datetimes are intentionally treated as timezone-naive local wall
    clock values (D-01). No timezone conversion occurs in this layer.
    """
    grouped: dict[date, list[DutySegment]] = {}

    for segment in segments:
        cursor = segment.start
        while cursor < segment.end:
            next_midnight = datetime.combine(
                cursor.date() + timedelta(days=1), time.min
            )
            piece_end = min(segment.end, next_midnight)
            piece = DutySegment(
                status=segment.status,
                start=cursor,
                end=piece_end,
                note=segment.note,
            )
            grouped.setdefault(cursor.date(), []).append(piece)
            cursor = piece_end

    log_days = []
    for day in sorted(grouped):
        pieces = grouped[day]
        day_start = datetime.combine(day, time.min)
        day_end = day_start + timedelta(days=1)

        if pieces[0].start > day_start:
            pieces.insert(
                0,
                DutySegment(
                    status=DutyStatus.OFF_DUTY,
                    start=day_start,
                    end=pieces[0].start,
                    note="outside trip",
                ),
            )
        if pieces[-1].end < day_end:
            pieces.append(
                DutySegment(
                    status=DutyStatus.OFF_DUTY,
                    start=pieces[-1].end,
                    end=day_end,
                    note="outside trip",
                )
            )

        log_days.append(LogDay(date=day, segments=pieces))

    return log_days
