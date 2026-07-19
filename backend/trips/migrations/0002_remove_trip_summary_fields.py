from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("trips", "0001_initial"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="trip",
            name="departure_assumed",
        ),
        migrations.RemoveField(
            model_name="trip",
            name="duty_segment_count",
        ),
        migrations.RemoveField(
            model_name="trip",
            name="leg_count",
        ),
        migrations.RemoveField(
            model_name="trip",
            name="log_day_count",
        ),
        migrations.RemoveField(
            model_name="trip",
            name="stop_count",
        ),
        migrations.RemoveField(
            model_name="trip",
            name="total_distance_miles",
        ),
        migrations.RemoveField(
            model_name="trip",
            name="total_duration_minutes",
        ),
    ]
