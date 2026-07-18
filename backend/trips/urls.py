"""The intentionally small public trip API surface."""

from django.urls import path

from trips.views import LocationSearchView, TripCreateView, TripDetailView


app_name = "trips"

urlpatterns = [
    path("locations/", LocationSearchView.as_view(), name="location-search"),
    path("trips/", TripCreateView.as_view(), name="create"),
    path("trips/<uuid:trip_id>/", TripDetailView.as_view(), name="detail"),
]
