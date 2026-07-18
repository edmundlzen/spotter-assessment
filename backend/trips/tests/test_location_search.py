"""Location autocomplete API and provider-boundary coverage."""

from unittest.mock import Mock, patch

import pytest
from django.core.cache import cache
from rest_framework.throttling import ScopedRateThrottle

from trips.services.ors_client import ProviderError, ResolvedLocation


@pytest.fixture(autouse=True)
def clear_location_caches():
    cache.clear()
    yield
    cache.clear()


@pytest.mark.parametrize("query", ["", " ", "NY"])
def test_location_search_rejects_short_or_blank_queries(client, query):
    response = client.get("/api/locations/", {"q": query})

    assert response.status_code == 400
    assert set(response.json()) == {"q"}


def test_location_search_returns_sanitized_ordered_suggestions(client):
    provider = Mock()
    provider.search.return_value = (
        ResolvedLocation(
            "Chicago",
            "Chicago, Cook County, Illinois, USA",
            -87.6298,
            41.8781,
        ),
        ResolvedLocation(
            "Chicago",
            "Chicago Heights, Cook County, Illinois, USA",
            -87.6356,
            41.5061,
        ),
    )

    with patch("trips.views._ors_client", return_value=provider):
        response = client.get("/api/locations/", {"q": " Chicago "})

    assert response.status_code == 200
    assert response.json() == {
        "results": [
            {
                "label": "Chicago, Cook County, Illinois, USA",
                "coordinate": [-87.6298, 41.8781],
            },
            {
                "label": "Chicago Heights, Cook County, Illinois, USA",
                "coordinate": [-87.6356, 41.5061],
            },
        ]
    }
    provider.search.assert_called_once_with("Chicago", limit=5)


def test_location_search_caches_case_insensitive_queries(client):
    provider = Mock()
    provider.search.return_value = (
        ResolvedLocation("Chicago", "Chicago, Illinois, USA", -87.63, 41.88),
    )

    with patch("trips.views._ors_client", return_value=provider):
        first = client.get("/api/locations/", {"q": "Chicago"})
        second = client.get("/api/locations/", {"q": "chicago"})

    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    provider.search.assert_called_once()


def test_location_search_sanitizes_provider_failures(client):
    provider = Mock()
    provider.search.side_effect = ProviderError(
        "upstream Authorization=secret"
    )

    with patch("trips.views._ors_client", return_value=provider):
        response = client.get("/api/locations/", {"q": "Chicago"})

    assert response.status_code == 503
    assert response.json() == {
        "detail": "The routing service is temporarily unavailable."
    }
    assert "secret" not in response.content.decode()


def test_location_search_is_rate_limited(client):
    provider = Mock()
    provider.search.return_value = ()

    rates = {"location_search": "2/minute", "trip_create": "30/hour"}
    with (
        patch.object(ScopedRateThrottle, "THROTTLE_RATES", rates),
        patch("trips.views._ors_client", return_value=provider),
    ):
        responses = [
            client.get("/api/locations/", {"q": "Chicago"})
            for _ in range(3)
        ]

    assert [response.status_code for response in responses] == [200, 200, 429]
