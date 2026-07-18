"""URL configuration for the Spotter ELD Trip Planner backend."""

from django.urls import include, path

from config.views import health

urlpatterns = [
    path("api/health/", health, name="health"),
    path("api/", include("trips.urls")),
]
