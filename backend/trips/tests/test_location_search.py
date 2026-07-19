"""Location autocomplete API and provider-boundary coverage."""

from unittest.mock import Mock, patch

import pytest
from django.core.cache import cache

from trips.services.ors_client import ProviderError, ResolvedLocation


@pytest.fixture(autouse=True)
def clear_location_caches():
    cache.clear()
    yield
    cache.clear()


def test_location_search_returns_sanitized_ordered_suggestions(client):
    provider = Mock()
    provider.search.return_value = (
        ResolvedLocation(
            "Chicago",
            "Chicago, Cook County, Illinois, USA",
            -87.6298,
            41.8781,
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
        ]
    }
    provider.search.assert_called_once_with("Chicago", limit=5)


def test_location_search_sanitizes_provider_failures(client):
    provider = Mock()
    provider.search.side_effect = ProviderError("upstream Authorization=secret")

    with patch("trips.views._ors_client", return_value=provider):
        response = client.get("/api/locations/", {"q": "Chicago"})

    assert response.status_code == 503
    assert response.json() == {
        "detail": "The routing service is temporarily unavailable."
    }
    assert "secret" not in response.content.decode()
