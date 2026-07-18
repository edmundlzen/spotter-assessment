import uuid
from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models


class Trip(models.Model):
    """One durable, normalized trip result ready for stored-only rendering."""

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    total_distance_miles = models.DecimalField(
        max_digits=12,
        decimal_places=3,
        validators=[MinValueValidator(Decimal("0"))],
    )
    total_duration_minutes = models.PositiveIntegerField()
    leg_count = models.PositiveIntegerField()
    stop_count = models.PositiveIntegerField()
    duty_segment_count = models.PositiveIntegerField()
    log_day_count = models.PositiveIntegerField()
    departure_assumed = models.BooleanField(default=True)
    result_snapshot = models.JSONField()
