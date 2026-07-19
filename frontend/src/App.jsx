import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import AddRoadOutlined from "@mui/icons-material/AddRoadOutlined"
import LocalShippingOutlined from "@mui/icons-material/LocalShippingOutlined"
import {
  Alert,
  AppBar,
  Box,
  Button,
  CircularProgress,
  Container,
  Paper,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material"

import TripForm from "./components/TripForm.jsx"
import {
  TripApiError,
  createTrip,
  getTrip,
  searchLocations,
} from "./api/trips.js"
import "./index.css"

const TripResults = lazy(() => import("./components/TripResults.jsx"))
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL
const REQUEST_TIMEOUT_MS = 120_000
const WAKE_MESSAGE_DELAY_MS = 8_000
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function tripIdFromPath() {
  const match = window.location.pathname.match(/^\/trips\/([^/]+)\/?$/)
  return match && UUID_PATTERN.test(match[1]) ? match[1] : null
}

function fieldErrorsFrom(error) {
  if (!(error instanceof TripApiError) || !error.details) return {}
  return Object.fromEntries(
    Object.entries(error.details)
      .filter(([key, value]) => key !== "detail" && Array.isArray(value))
      .map(([key, value]) => [key, value.join(" ")]),
  )
}

function friendlyError(error, stage) {
  if (error?.name === "AbortError") {
    return "The planning server took too long to respond. Please try again."
  }
  if (stage === "retrieve" && error?.status === 404) {
    return "This saved trip could not be found. Check the link and try again."
  }
  if (error?.details?.detail && typeof error.details.detail === "string") {
    return error.details.detail
  }
  if (stage === "retrieve") {
    return "We couldn’t load this saved trip. Check the link and try again."
  }
  return "The routing service couldn’t complete this trip. Check the locations and try again."
}

function AppHeader({ onNewTrip, showNewTrip }) {
  return (
    <AppBar
      className="app-header"
      color="transparent"
      component="header"
      elevation={0}
      position="sticky"
      sx={{
        backdropFilter: "blur(14px)",
        bgcolor: "rgba(255, 255, 255, 0.92)",
        borderBottom: "1px solid",
        borderColor: "divider",
      }}
    >
      <Toolbar disableGutters sx={{ minHeight: { xs: 64, sm: 72 } }}>
        <Container
          maxWidth="xl"
          sx={{
            alignItems: "center",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <Button
            aria-label="ELD Trip Planner home"
            color="inherit"
            onClick={onNewTrip}
            startIcon={
              <Box
                component="span"
                sx={{
                  alignItems: "center",
                  bgcolor: "primary.main",
                  borderRadius: 2,
                  boxShadow: "0 5px 12px rgba(21, 94, 239, 0.2)",
                  color: "primary.contrastText",
                  display: "inline-flex",
                  height: { xs: 36, sm: 40 },
                  justifyContent: "center",
                  width: { xs: 36, sm: 40 },
                }}
              >
                <LocalShippingOutlined fontSize="small" />
              </Box>
            }
            sx={{
              color: "text.primary",
              minWidth: 0,
              p: 0,
              textAlign: "left",
              "&:hover": { bgcolor: "transparent" },
              "& .MuiButton-startIcon": { ml: 0, mr: 1.5 },
            }}
          >
            <Stack component="span" spacing={0}>
              <Typography
                component="span"
                sx={{
                  fontSize: { xs: 15, sm: 16 },
                  fontWeight: 750,
                  letterSpacing: "-0.015em",
                  lineHeight: 1.25,
                }}
              >
                ELD Trip Planner
              </Typography>
              <Typography
                color="text.secondary"
                component="span"
                sx={{
                  display: { xs: "none", sm: "block" },
                  fontSize: 12,
                  fontWeight: 500,
                  lineHeight: 1.35,
                }}
              >
                Route planning &amp; driver logs
              </Typography>
            </Stack>
          </Button>
          {showNewTrip && (
            <Button
              color="primary"
              onClick={onNewTrip}
              size="small"
              startIcon={<AddRoadOutlined />}
              type="button"
              variant="outlined"
            >
              New trip
            </Button>
          )}
        </Container>
      </Toolbar>
    </AppBar>
  )
}

function LoadingView({ message }) {
  return (
    <Container component="main" maxWidth="sm" sx={{ py: { xs: 6, md: 10 } }}>
      <Paper
        aria-live="polite"
        elevation={3}
        sx={{ p: { xs: 4, sm: 6 }, textAlign: "center" }}
      >
        <CircularProgress size={38} sx={{ mb: 3 }} />
        <Typography component="h1" gutterBottom variant="h5">
          {message}
        </Typography>
      </Paper>
    </Container>
  )
}

function SavedTripError({ message, onNewTrip, onRetry }) {
  return (
    <Container component="main" maxWidth="sm" sx={{ py: { xs: 6, md: 10 } }}>
      <Paper elevation={2} sx={{ p: { xs: 3, sm: 4 } }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          <Typography component="h1" fontWeight={700} gutterBottom variant="h6">
            Trip unavailable
          </Typography>
          {message}
        </Alert>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <Button onClick={onRetry} variant="contained">
            Try again
          </Button>
          <Button onClick={onNewTrip} variant="outlined">
            Plan a new trip
          </Button>
        </Stack>
      </Paper>
    </Container>
  )
}

export default function App() {
  const [view, setView] = useState({ name: "planner" })
  const [shareStatus, setShareStatus] = useState("idle")
  const activeRequest = useRef(null)
  const mounted = useRef(true)

  const cancelActiveRequest = useCallback(() => {
    activeRequest.current?.abort()
    activeRequest.current = null
  }, [])
  const searchLocationOptions = useCallback(
    (query, signal) => searchLocations(API_BASE_URL, query, signal),
    [],
  )

  const runRequest = useCallback(async (operation) => {
    cancelActiveRequest()
    const controller = new AbortController()
    activeRequest.current = controller

    const timeout = window.setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    )
    const wakeTimer = window.setTimeout(() => {
      if (mounted.current) {
        setView((current) =>
          current.name === "loading"
            ? { ...current, message: "The planning server is waking up…" }
            : current,
        )
      }
    }, WAKE_MESSAGE_DELAY_MS)

    try {
      return await operation(controller.signal)
    } finally {
      window.clearTimeout(timeout)
      window.clearTimeout(wakeTimer)
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }, [cancelActiveRequest])

  const loadSavedTrip = useCallback(async (tripId) => {
    setView({
      name: "loading",
      message: "Loading saved trip…",
      stage: "retrieve",
      tripId,
    })
    try {
      const snapshot = await runRequest((signal) =>
        getTrip(API_BASE_URL, tripId, signal),
      )
      if (mounted.current) setView({ name: "result", snapshot })
    } catch (error) {
      if (!mounted.current) return
      setView({
        name: "saved-error",
        message: friendlyError(error, "retrieve"),
        tripId,
      })
    }
  }, [runRequest])

  useEffect(() => {
    mounted.current = true
    const syncPath = () => {
      const tripId = tripIdFromPath()
      if (tripId) loadSavedTrip(tripId)
      else {
        cancelActiveRequest()
        setView({ name: "planner" })
      }
    }
    syncPath()
    window.addEventListener("popstate", syncPath)
    return () => {
      mounted.current = false
      window.removeEventListener("popstate", syncPath)
      cancelActiveRequest()
    }
  }, [cancelActiveRequest, loadSavedTrip])

  async function planTrip(input) {
    if (activeRequest.current) return

    setView({
      name: "loading",
      message: "Planning trip…",
      stage: "create",
      input,
    })
    try {
      const created = await runRequest((signal) =>
        createTrip(API_BASE_URL, input, signal),
      )
      if (!mounted.current) return
      window.history.pushState({}, "", `/trips/${created.id}`)
      setView({
        name: "loading",
        message: "Loading route and log sheets…",
        stage: "retrieve",
        tripId: created.id,
      })
      const snapshot = await runRequest((signal) =>
        getTrip(API_BASE_URL, created.id, signal),
      )
      if (mounted.current) setView({ name: "result", snapshot })
    } catch (error) {
      if (!mounted.current) return
      const fields = fieldErrorsFrom(error)
      window.history.replaceState({}, "", "/")
      setView({
        name: "planner",
        error: Object.keys(fields).length ? null : friendlyError(error, "create"),
        fieldErrors: fields,
        initialValues: input,
      })
    }
  }

  function newTrip() {
    cancelActiveRequest()
    window.history.pushState({}, "", "/")
    setShareStatus("idle")
    setView({ name: "planner" })
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  async function shareTrip() {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      window.prompt("Copy this trip link:", url)
    }
    setShareStatus("copied")
    window.setTimeout(() => setShareStatus("idle"), 2_000)
  }

  return (
    <Box sx={{ minHeight: "100vh" }}>
      <AppHeader onNewTrip={newTrip} showNewTrip={view.name !== "planner"} />
      {view.name === "planner" && (
        <Container
          component="main"
          maxWidth="sm"
          sx={{ minWidth: 0, overflow: "hidden", py: { xs: 3, sm: 6 } }}
        >
          <TripForm
            busy={false}
            error={view.error}
            fieldErrors={view.fieldErrors}
            initialValues={view.initialValues}
            loadingMessage=""
            onSearchLocations={searchLocationOptions}
            onSubmit={planTrip}
          />
          <Typography
            align="center"
            color="text.secondary"
            display="block"
            sx={{ mt: 2, overflowWrap: "anywhere" }}
            variant="caption"
          >
            Planning aid for property-carrying drivers. Review the route and
            logs before operating.
          </Typography>
        </Container>
      )}
      {view.name === "loading" && <LoadingView message={view.message} />}
      {view.name === "saved-error" && (
        <SavedTripError
          message={view.message}
          onNewTrip={newTrip}
          onRetry={() => loadSavedTrip(view.tripId)}
        />
      )}
      {view.name === "result" && (
        <Suspense fallback={<LoadingView message="Loading trip view…" />}>
          <TripResults
            onNewTrip={newTrip}
            onShare={shareTrip}
            shareStatus={shareStatus}
            snapshot={view.snapshot}
          />
        </Suspense>
      )}
    </Box>
  )
}
