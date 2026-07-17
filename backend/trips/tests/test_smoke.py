"""Proves the pytest harness collects and the fixture wiring works."""


def test_base_start_datetime_is_naive(base_start_datetime):
    assert base_start_datetime.tzinfo is None
