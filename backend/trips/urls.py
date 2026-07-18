"""The intentionally small public trip API surface."""

from django.urls import path

from trips.views import TripCreateView, TripDetailView


app_name = "trips"

urlpatterns = [
    path("trips/", TripCreateView.as_view(), name="create"),
    path("trips/<uuid:trip_id>/", TripDetailView.as_view(), name="detail"),
]
