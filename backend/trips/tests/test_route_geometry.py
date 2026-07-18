from datetime import datetime, timedelta

import pytest

from trips.hos_engine.models import DutySegment, DutyStatus, Stop
from trips.services.ors_client import ResolvedRoute, ResolvedRouteLeg
from trips.services.route_geometry import resolve_stops


METERS_PER_MILE = 1609.344


def make_route():
    return ResolvedRoute(
        total_meters=3 * METERS_PER_MILE,
        total_seconds=300,
        legs=(
            ResolvedRouteLeg(METERS_PER_MILE, 100, 0, 2),
            ResolvedRouteLeg(2 * METERS_PER_MILE, 200, 2, 4),
        ),
        geometry=(
            (0.0, 0.0),
            (0.005, 0.0),
            (0.01, 0.0),
            (0.02, 0.0),
            (0.03, 0.0),
        ),
        waypoint_indices=(0, 2, 4),
    )


def make_stop(marker, kind="rest"):
    start = datetime(2026, 7, 18, 8)
    return Stop(
        kind=kind,
        cumulative_miles=marker,
        segment=DutySegment(
            status=DutyStatus.OFF_DUTY,
            start=start,
            end=start + timedelta(minutes=30),
        ),
    )


def test_exact_route_and_leg_boundaries_return_waypoints_exactly():
    route = make_route()

    result = resolve_stops(
        [
            make_stop(0, "current"),
            make_stop(1, "pickup"),
            make_stop(3, "dropoff"),
        ],
        route,
    )

    assert result == [(0.0, 0.0), (0.01, 0.0), (0.03, 0.0)]


def test_interior_targets_interpolate_inside_the_selected_leg():
    route = make_route()

    result = resolve_stops(
        [make_stop(0.5), make_stop(2.0)],
        route,
    )

    assert result[0] == pytest.approx((0.005, 0.0))
    assert result[1] == pytest.approx((0.02, 0.0))


def test_empty_and_single_stop_sequences_preserve_cardinality():
    route = make_route()

    assert resolve_stops([], route) == []
    assert resolve_stops([make_stop(1)], route) == [(0.01, 0.0)]


def test_input_order_is_stable_for_equal_and_nonmonotonic_markers():
    route = make_route()
    stops = [
        make_stop(2, "first"),
        make_stop(1, "middle"),
        make_stop(2, "last"),
    ]

    result = resolve_stops(iter(stops), route)

    assert result == [
        pytest.approx((0.02, 0.0)),
        (0.01, 0.0),
        pytest.approx((0.02, 0.0)),
    ]


@pytest.mark.parametrize(
    "marker",
    [None, float("nan"), float("inf"), -0.01, 3.01, "one"],
)
def test_invalid_markers_fail_closed(marker):
    with pytest.raises(ValueError, match="marker"):
        resolve_stops([make_stop(marker)], make_route())


def test_tiny_boundary_rounding_is_clamped_to_exact_waypoints():
    tolerance_noise = 1e-10

    assert resolve_stops(
        [make_stop(-tolerance_noise), make_stop(3 + tolerance_noise)],
        make_route(),
    ) == [(0.0, 0.0), (0.03, 0.0)]


@pytest.mark.parametrize(
    "route",
    [
        ResolvedRoute(
            total_meters=3 * METERS_PER_MILE,
            total_seconds=300,
            legs=(
                ResolvedRouteLeg(METERS_PER_MILE, 100, 0, 3),
                ResolvedRouteLeg(2 * METERS_PER_MILE, 200, 2, 4),
            ),
            geometry=((0, 0), (0.005, 0), (0.01, 0), (0.02, 0), (0.03, 0)),
            waypoint_indices=(0, 2, 4),
        ),
        ResolvedRoute(
            total_meters=3 * METERS_PER_MILE,
            total_seconds=300,
            legs=(
                ResolvedRouteLeg(METERS_PER_MILE, 100, 0, 2),
                ResolvedRouteLeg(2 * METERS_PER_MILE, 200, 2, 4),
            ),
            geometry=((0, 0), (0.01, 0), (0.01, 0), (0.01, 0), (0.01, 0)),
            waypoint_indices=(0, 2, 4),
        ),
    ],
)
def test_invalid_route_geometry_fails_closed(route):
    with pytest.raises(ValueError, match="route"):
        resolve_stops([make_stop(0.5)], route)
