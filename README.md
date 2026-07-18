# Spotter ELD Trip Planner

Spotter ELD Trip Planner is being built as a Django and React application for
planning property-carrying trips and producing Hours-of-Service-compliant
schedules and daily logs. The current deployable shell is limited to proving
that a Vercel-hosted React client can reach a Render-hosted Django API through
an exact CORS allowlist.

## Prerequisites

- Python 3.14 (the Render runtime line is pinned in `backend/.python-version`)
- Node.js 22.12 or newer
- npm

## Run locally

### Backend

From the repository root:

```sh
cd backend
python -m venv .venv
```

Activate the environment with `.venv\Scripts\Activate.ps1` in PowerShell or
`source .venv/bin/activate` in a POSIX shell, then run:

```sh
python -m pip install -r requirements.txt -r requirements-dev.txt
python manage.py runserver
```

The health endpoint is available at
`http://127.0.0.1:8000/api/health/` and returns exactly:

```json
{"status": "ok"}
```

Run the backend tests from `backend` with:

```sh
pytest
```

### Frontend

In a second terminal, from the repository root:

```sh
cd frontend
npm ci
```

Copy `frontend/.env.example` to `frontend/.env`, set
`VITE_API_BASE_URL=http://127.0.0.1:8000`, and start Vite:

```sh
npm run dev
```

Open the local URL printed by Vite. The page first shows
`Connecting to backend...`, then `Backend connected`. If the request fails, it
shows `Unable to connect to backend` and a `Retry` button. Run the frontend
tests with `npm test -- --run` and create a production build with
`npm run build`.

## Environment variables

### Backend

Use `backend/.env.example` as the local template. Do not commit `.env` or real
secret values.

| Variable | Required on Render | Format and purpose |
| --- | --- | --- |
| `SECRET_KEY` | Yes | A large random secret. The Render Blueprint generates it; never expose it to the frontend. |
| `DEBUG` | Yes | Set to `False` in production. |
| `ALLOWED_HOSTS` | No | Comma-separated **bare hostnames** only, such as `localhost,127.0.0.1`; do not include a scheme or path. Render adds its exact hostname through `RENDER_EXTERNAL_HOSTNAME`. |
| `RENDER_EXTERNAL_HOSTNAME` | Supplied by Render | Render's bare external hostname. Django adds it to `ALLOWED_HOSTS`; do not set this to a URL. |
| `CORS_ALLOWED_ORIGINS` | Yes | Comma-separated **full origins**, including scheme and optional port, such as `http://localhost:5173`. Production must contain the exact Vercel origin and must not use a wildcard. |
| `DATABASE_URL` | No | Optional database URL. When omitted, Django uses local SQLite; the health endpoint does not query a database. |

### Frontend

| Variable | Required | Format and purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Yes | Public backend origin with no `/api/health/` suffix, for example `https://service-name.onrender.com`. Vite embeds this value at build time, so changing it requires a new Vercel deployment. |

Variables prefixed with `VITE_` are public browser configuration. Never put a
secret in one.

## Deploy

The deployment uses one Git repository, a Render Blueprint for the backend,
and Vercel's Vite support for the frontend.

### 1. Create the Render backend

1. Push the reviewed repository to the intended Git host.
2. In Render, create a Blueprint from the root `render.yaml`.
3. Confirm the Blueprint creates one free web service named
   `spotter-eld-api` with Root Directory `backend`.
4. Enter a temporary exact frontend origin for
   `CORS_ALLOWED_ORIGINS` if the production Vercel origin is not known yet.
   This is a required dashboard-supplied value; never use `*`.
5. Deploy and wait for `/api/health/` to become healthy.
6. Copy the provider-issued Render service origin, without the health path.

The Blueprint installs `backend/requirements.txt`, collects static files,
starts `gunicorn config.wsgi:application`, generates `SECRET_KEY`, forces
`DEBUG=False`, and checks `/api/health/`. It deliberately does not provision a
database or run migrations.

### 2. Create the Vercel frontend

1. Import the same repository into Vercel.
2. Set the project Root Directory to `frontend`.
3. Keep the detected Vite framework settings.
4. Add `VITE_API_BASE_URL` to the Production environment, using the
   provider-issued Render service origin without a trailing
   `/api/health/`.
5. Deploy and copy the provider-issued Vercel production origin.

### 3. Wire the two hosts exactly

1. In Render, set `CORS_ALLOWED_ORIGINS` to the exact Vercel production
   origin, including `https://` and with no path or wildcard.
2. Redeploy or restart the Render service so the new allowlist is active.
3. Reconfirm that Vercel's production `VITE_API_BASE_URL` is the exact Render
   service origin.
4. **Redeploy Vercel after every change to `VITE_API_BASE_URL`.** Updating a
   Vercel environment variable does not alter an already-built bundle.

## Deployment evidence

Status: **Captured against the live production services.**

- Vercel production URL: https://spotter-assessment-alpha.vercel.app
- Render health URL: https://spotter-eld-api-n2d3.onrender.com/api/health/
- Browser result: `Backend connected`
- Browser request status and payload: HTTP `200`, `{"status":"ok"}`
- Browser `Access-Control-Allow-Origin`: `https://spotter-assessment-alpha.vercel.app`
- Denied-Origin result: HTTP `200` with `{"status":"ok"}` and no
  `Access-Control-Allow-Origin` header

After deployment, capture the proof in this order:

1. Open the provider-issued Vercel production URL. The page may show
   `Connecting to backend...` for up to 75 seconds during a Render cold start.
   Record whether it reaches `Backend connected`; if it reaches
   `Unable to connect to backend`, inspect diagnostics and use `Retry`.
2. In browser DevTools, open Network and select the request to the
   provider-issued Render `/api/health/` URL. Confirm HTTP `200`, a response
   body exactly equal to `{"status":"ok"}`, and
   `Access-Control-Allow-Origin` exactly equal to the Vercel production
   origin.
3. If the page fails, inspect the Console. Diagnostics intentionally report
   only the category: timeout, HTTP, payload, or network/CORS.
4. From a terminal, replace the bracketed values below with the same
   provider-issued URLs and run the allowed-Origin request:

   ```sh
   curl -i -H "Origin: <exact-vercel-production-origin>" "<exact-render-health-url>"
   ```

   It must return HTTP `200`, exactly `{"status":"ok"}`, and one
   `Access-Control-Allow-Origin` header equal to the supplied Vercel origin.
5. Run the denied-Origin comparison:

   ```sh
   curl -i -H "Origin: https://untrusted.example" "<exact-render-health-url>"
   ```

   It must still return the public health response but must not include an
   `Access-Control-Allow-Origin` header.

Once the final URLs have been recorded above and the verifier is present, rerun
the portable HTTP/CORS assertions from PowerShell, Bash, or CI with:

```sh
python scripts/verify_live_deployment.py --readme README.md
```

This executable check does not replace the browser Network proof. A direct
backend response alone cannot prove that the deployed browser origin is allowed
to read the response.
