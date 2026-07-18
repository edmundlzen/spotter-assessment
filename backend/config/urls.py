"""URL configuration for the Spotter ELD Trip Planner backend."""

from django.urls import path

from config.views import health

urlpatterns = [
    path("api/health/", health, name="health"),
]
