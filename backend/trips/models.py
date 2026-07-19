import uuid

from django.db import models


class Trip(models.Model):
    """One durable, normalized trip result ready for stored-only rendering."""

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    result_snapshot = models.JSONField()
