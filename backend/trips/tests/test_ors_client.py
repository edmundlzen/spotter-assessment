import copy
import json
from pathlib import Path

import pytest
import requests

from trips.services.ors_client import (
    ORSClient,
    ProviderError,
    ResolvedLocation,
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


def test_geocode_returns_none_for_an_empty_result_without_retrying():
    payload = {"type": "FeatureCollection", "features": []}
    client, session = make_client([FakeResponse(payload)])

    assert client.geocode("not a real place") is None
    assert len(session.calls) == 1


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"features": [{}]},
        {
            "features": [
                {
                    "properties": {"label": "bad"},
                    "geometry": {
                        "type": "Point",
                        "coordinates": [181, 0],
                    },
                }
            ]
        },
        {
            "features": [
                {
                    "properties": {"label": "bad"},
                    "geometry": {
                        "type": "Point",
                        "coordinates": [0, float("nan")],
                    },
                }
            ]
        },
    ],
)
def test_geocode_rejects_malformed_upstream_payloads(payload):
    client, _ = make_client([FakeResponse(payload)])

    with pytest.raises(ProviderError, match="routing provider"):
        client.geocode("Chicago")


def test_route_posts_exactly_three_lon_lat_points_to_hgv_geojson():
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
    assert route.total_seconds == 240.0
    assert route.waypoint_indices == (0, 2, 4)
    assert route.geometry[0] == (-87.0, 41.0)
    assert route.geometry[-1] == (-86.97, 41.0)
    assert [(leg.distance_meters, leg.duration_seconds) for leg in route.legs] == [
        (1000.0, 80.0),
        (2000.0, 160.0),
    ]
    assert session.calls == [
        (
            "POST",
            ROUTE_URL,
            {
                "json": {
                    "coordinates": [
                        [-87.0, 41.0],
                        [-86.99, 41.0],
                        [-86.97, 41.0],
                    ]
                },
                "headers": {"Authorization": "server-secret"},
                "timeout": (1.25, 4.5),
            },
        )
    ]


@pytest.mark.parametrize(
    "mutation",
    [
        lambda body: body.update(features=[]),
        lambda body: body["features"].append(copy.deepcopy(body["features"][0])),
        lambda body: body["features"][0]["properties"]["summary"].update(
            distance=float("inf")
        ),
        lambda body: body["features"][0]["properties"].update(segments=[]),
        lambda body: body["features"][0]["properties"]["segments"][0].update(
            duration=-1
        ),
        lambda body: body["features"][0]["properties"]["segments"][1].update(
            way_points=[1, 4]
        ),
        lambda body: body["features"][0]["geometry"].update(type="Point"),
        lambda body: body["features"][0]["geometry"].update(
            coordinates=[[200, 41]]
        ),
    ],
)
def test_route_rejects_malformed_shape_units_and_waypoints(mutation):
    payload = load_fixture("ors_route_success.json")
    mutation(payload)
    client, _ = make_client([FakeResponse(payload)])

    with pytest.raises(ProviderError, match="routing provider"):
        client.route(
            [
                ResolvedLocation("a", "A", -87, 41),
                ResolvedLocation("b", "B", -86.99, 41),
                ResolvedLocation("c", "C", -86.97, 41),
            ]
        )


def test_route_requires_exactly_three_locations_before_transport():
    client, session = make_client([])

    with pytest.raises(ValueError, match="exactly three"):
        client.route([ResolvedLocation("a", "A", -87, 41)])
    assert session.calls == []


@pytest.mark.parametrize(
    ("first_response", "expected_calls"),
    [
        (requests.ConnectTimeout("contains upstream details"), 2),
        (FakeResponse({}, status_code=429), 2),
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


def test_read_timeout_and_other_transport_errors_are_not_retried():
    client, session = make_client(
        [requests.ReadTimeout("raw provider failure")]
    )

    with pytest.raises(ProviderError) as caught:
        client.geocode("Chicago")

    assert len(session.calls) == 1
    assert str(caught.value) == "The routing provider is unavailable."


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"api_key": ""}, "api_key"),
        ({"connect_timeout": 0}, "connect_timeout"),
        ({"read_timeout": float("nan")}, "read_timeout"),
        ({"max_retries": 2}, "max_retries"),
    ],
)
def test_client_rejects_unsafe_configuration(kwargs, message):
    defaults = {
        "api_key": "key",
        "connect_timeout": 1,
        "read_timeout": 1,
        "max_retries": 0,
    }
    defaults.update(kwargs)

    with pytest.raises(ValueError, match=message):
        ORSClient(**defaults)
