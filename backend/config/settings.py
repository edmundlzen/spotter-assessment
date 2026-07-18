"""Django settings for the Spotter ELD Trip Planner backend."""

import math
from pathlib import Path
from urllib.parse import urlsplit

import environ
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
    ORS_CONNECT_TIMEOUT_SECONDS=(float, 3.05),
    ORS_MAX_RETRIES=(int, 1),
    ORS_READ_TIMEOUT_SECONDS=(float, 15.0),
    RENDER=(bool, False),
)
environ.Env.read_env(BASE_DIR / ".env")

IS_RENDER = env.bool("RENDER", default=False)
DEBUG = env.bool("DEBUG", default=False)


def _clean_list(name, default):
    return [
        value.strip()
        for value in env.list(name, default=default)
        if value.strip()
    ]


def _validate_host(host, setting_name):
    if (
        host.startswith(".")
        or "*" in host
        or "://" in host
        or "/" in host
        or any(character.isspace() for character in host)
    ):
        raise ImproperlyConfigured(
            f"{setting_name} must contain exact bare hostnames only."
        )


def _validate_origin(origin):
    parsed = urlsplit(origin)
    if (
        "*" in origin
        or parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ImproperlyConfigured(
            "CORS_ALLOWED_ORIGINS must contain exact http(s) origins."
        )


SECRET_KEY = env("SECRET_KEY", default="")
ORS_API_KEY = env("ORS_API_KEY", default="").strip()
if IS_RENDER:
    if not SECRET_KEY.strip():
        raise ImproperlyConfigured("SECRET_KEY is required on Render.")
    if DEBUG:
        raise ImproperlyConfigured("DEBUG must be False on Render.")
    if not ORS_API_KEY:
        raise ImproperlyConfigured("ORS_API_KEY is required on Render.")
else:
    SECRET_KEY = SECRET_KEY or "django-insecure-local-development-only"

ORS_CONNECT_TIMEOUT_SECONDS = env.float(
    "ORS_CONNECT_TIMEOUT_SECONDS", default=3.05
)
ORS_READ_TIMEOUT_SECONDS = env.float(
    "ORS_READ_TIMEOUT_SECONDS", default=15.0
)
ORS_MAX_RETRIES = env.int("ORS_MAX_RETRIES", default=1)

for setting_name, value in (
    ("ORS_CONNECT_TIMEOUT_SECONDS", ORS_CONNECT_TIMEOUT_SECONDS),
    ("ORS_READ_TIMEOUT_SECONDS", ORS_READ_TIMEOUT_SECONDS),
):
    if not math.isfinite(value) or value <= 0:
        raise ImproperlyConfigured(
            f"{setting_name} must be a finite positive number."
        )
if ORS_MAX_RETRIES not in {0, 1}:
    raise ImproperlyConfigured("ORS_MAX_RETRIES must be 0 or 1.")

local_hosts = ["localhost", "127.0.0.1", "testserver"]
ALLOWED_HOSTS = _clean_list(
    "ALLOWED_HOSTS",
    default=[] if IS_RENDER else local_hosts,
)
for host in ALLOWED_HOSTS:
    _validate_host(host, "ALLOWED_HOSTS")

render_hostname = env("RENDER_EXTERNAL_HOSTNAME", default="").strip()
if IS_RENDER:
    if not render_hostname:
        raise ImproperlyConfigured(
            "RENDER_EXTERNAL_HOSTNAME is required on Render."
        )
    _validate_host(render_hostname, "RENDER_EXTERNAL_HOSTNAME")
    ALLOWED_HOSTS.append(render_hostname)
ALLOWED_HOSTS = list(dict.fromkeys(ALLOWED_HOSTS))

CORS_ALLOWED_ORIGINS = _clean_list("CORS_ALLOWED_ORIGINS", default=[])
for origin in CORS_ALLOWED_ORIGINS:
    _validate_origin(origin)
if IS_RENDER and not CORS_ALLOWED_ORIGINS:
    raise ImproperlyConfigured(
        "CORS_ALLOWED_ORIGINS requires at least one exact origin on Render."
    )

CORS_ALLOW_ALL_ORIGINS = False
CORS_URLS_REGEX = r"^/api/.*$"

INSTALLED_APPS = [
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "trips.apps.TripsConfig",
]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "UNAUTHENTICATED_USER": None,
}

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": env.db(
        "DATABASE_URL",
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
    )
}

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
