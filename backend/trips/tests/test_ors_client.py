import json
from pathlib import Path

import pytest
import requests

from trips.services.ors_client import (
    ORSClient,
    ProviderError,
    ResolvedLocation,
    RouteUnavailableError,
)


FIXTURES = Path(__file__).parent / "fixtures"
GEOCODE_URL = "https://api.openrouteservice.org/geocode/search"
ROUTE_URL = (
    "https://api.openrouteservice.org/v2/directions/driving-hgv/geojson"
)


def load_fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class FakeResponse:
    def __init__(self, payload=None, status_code=200):
        self.payload = payload
        self.status_code = status_code

    def json(self):
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def _request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    def get(self, url, **kwargs):
        return self._request("GET", url, **kwargs)

    def post(self, url, **kwargs):
        return self._request("POST", url, **kwargs)


def make_client(responses, *, retries=1):
    session = FakeSession(responses)
    client = ORSClient(
        api_key="server-secret",
        connect_timeout=1.25,
        read_timeout=4.5,
        max_retries=retries,
        session=session,
    )
    return client, session


_THREE_LOCATIONS = [
    ResolvedLocation("a", "A", -98.38, 38.50),
    ResolvedLocation("b", "B", -86.99, 41.0),
    ResolvedLocation("c", "C", -86.97, 41.0),
]


def test_geocode_uses_fixed_us_endpoint_and_preserves_resolved_values():
    client, session = make_client(
        [FakeResponse(load_fixture("ors_geocode_success.json"))]
    )

    location = client.geocode("Chicago, IL")

    assert location == ResolvedLocation(
        original_query="Chicago, IL",
        display_label="Chicago, Cook County, Illinois, USA",
        longitude=-87.6298,
        latitude=41.8781,
    )
    assert session.calls == [
        (
            "GET",
            GEOCODE_URL,
            {
                "params": {
                    "text": "Chicago, IL",
                    "boundary.country": "USA",
                    "size": 1,
                },
                "headers": {"Authorization": "server-secret"},
                "timeout": (1.25, 4.5),
            },
        )
    ]


def test_route_posts_three_snapped_lon_lat_points_to_hgv_geojson():
    client, session = make_client(
        [FakeResponse(load_fixture("ors_route_success.json"))]
    )
    locations = [
        ResolvedLocation("current", "Current", -87.0, 41.0),
        ResolvedLocation("pickup", "Pickup", -86.99, 41.0),
        ResolvedLocation("dropoff", "Dropoff", -86.97, 41.0),
    ]

    route = client.route(locations)

    assert route.total_meters == 3000.0
    assert route.waypoint_indices == (0, 2, 4)
    assert [(leg.distance_meters, leg.duration_seconds) for leg in route.legs] == [
        (1000.0, 80.0),
        (2000.0, 160.0),
    ]
    assert session.calls[0][2]["json"] == {
        "coordinates": [
            [-87.0, 41.0],
            [-86.99, 41.0],
            [-86.97, 41.0],
        ],
        "radiuses": [-1, -1, -1],
    }


@pytest.mark.parametrize("code", [2004, 2009, 2010])
def test_route_reports_unroutable_locations_distinctly_from_an_outage(code):
    body = {
        "error": {
            "code": code,
            "message": "Could not find routable point within 350.0 meters.",
        }
    }
    client, _ = make_client([FakeResponse(body, status_code=404)])

    with pytest.raises(RouteUnavailableError) as caught:
        client.route(_THREE_LOCATIONS)

    assert "350.0 meters" not in str(caught.value)


@pytest.mark.parametrize(
    ("first_response", "expected_calls"),
    [
        (requests.ConnectTimeout("contains upstream details"), 2),
        (FakeResponse({}, status_code=503), 2),
        (FakeResponse({}, status_code=400), 1),
    ],
)
def test_retry_policy_is_bounded_and_errors_are_sanitized(
    first_response, expected_calls
):
    client, session = make_client(
        [first_response, FakeResponse({}, status_code=400)]
    )

    with pytest.raises(ProviderError) as caught:
        client.geocode("secret query")

    assert len(session.calls) == expected_calls
    message = str(caught.value)
    assert "server-secret" not in message
    assert "contains upstream details" not in message
    assert "secret query" not in message
