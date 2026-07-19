"""Tests for hos_engine.rules: constants and the three-independent-gate legality functions."""
from datetime import datetime, timedelta

from trips.hos_engine.models import DutyStatus
from trips.hos_engine import rules
from trips.hos_engine.rules import driving_is_legal, satisfies_break


class TestConstants:
    def test_constants_are_integer_minutes(self):
        assert rules.DRIVE_LIMIT_MIN == 11 * 60
        assert rules.WINDOW_LIMIT_MIN == 14 * 60
        assert rules.BREAK_TRIGGER_MIN == 8 * 60
        assert rules.BREAK_DURATION_MIN == 30
        assert rules.CYCLE_LIMIT_MIN == 70 * 60
        assert rules.RESET_MIN == 10 * 60
        assert rules.RESTART_MIN == 34 * 60
        assert rules.FUEL_INTERVAL_MILES == 1000
        assert rules.PICKUP_MIN_DEFAULT == 60
        assert rules.DROPOFF_MIN_DEFAULT == 60

    def test_fuel_break_combine_window_pinned_at_60(self):
        assert rules.FUEL_BREAK_COMBINE_WINDOW_MIN == 60


class TestDrivingIsLegal:
    def test_all_gates_slack_returns_true(self):
        now = datetime(2026, 1, 1, 10, 0)
        window_deadline = datetime(2026, 1, 1, 20, 0)
        assert driving_is_legal(now, window_deadline, drive_accum_min=300, drive_since_break_min=180) is True

    def test_driving_is_legal_window_gate(self):
        """The 14h window gate is independent of the other two.

        drive_accum_min=300 (5h, well under the 11h limit) and
        drive_since_break_min=180 (3h, well under the 8h break trigger) are
        both slack, yet `now` is one minute past the window deadline — the
        function must still return False, proving the window gate is never
        extended or bypassed by the other two gates being slack.
        """
        window_deadline = datetime(2026, 1, 1, 20, 0)
        now = window_deadline + timedelta(minutes=1)
        assert (
            driving_is_legal(
                now,
                window_deadline,
                drive_accum_min=300,
                drive_since_break_min=180,
            )
            is False
        )

    def test_drive_limit_gate_alone_forces_false(self):
        now = datetime(2026, 1, 1, 10, 0)
        window_deadline = datetime(2026, 1, 1, 20, 0)
        assert (
            driving_is_legal(
                now,
                window_deadline,
                drive_accum_min=rules.DRIVE_LIMIT_MIN,
                drive_since_break_min=0,
            )
            is False
        )

    def test_break_trigger_gate_alone_forces_false(self):
        now = datetime(2026, 1, 1, 10, 0)
        window_deadline = datetime(2026, 1, 1, 20, 0)
        assert (
            driving_is_legal(
                now,
                window_deadline,
                drive_accum_min=0,
                drive_since_break_min=rules.BREAK_TRIGGER_MIN,
            )
            is False
        )


class TestSatisfiesBreak:
    def test_thirty_minute_off_duty_block_qualifies(self):
        assert satisfies_break(DutyStatus.OFF_DUTY, 30) is True

    def test_thirty_minute_on_duty_not_driving_block_qualifies(self):
        assert satisfies_break(DutyStatus.ON_DUTY_NOT_DRIVING, 30) is True

    def test_twenty_nine_minute_block_does_not_qualify(self):
        assert satisfies_break(DutyStatus.OFF_DUTY, 29) is False

    def test_driving_block_never_qualifies_regardless_of_duration(self):
        assert satisfies_break(DutyStatus.DRIVING, 60) is False
