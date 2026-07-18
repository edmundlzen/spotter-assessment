"""Process-level health checks for the Django service."""

from django.http import JsonResponse


def health(request):
    """Report only that the Django process can serve HTTP requests."""
    return JsonResponse({"status": "ok"})
