import { useCallback, useEffect, useRef, useState } from "react"

import TripForm from "./components/TripForm.jsx"
import TripResults from "./components/TripResults.jsx"
import { TripApiError, createTrip, getTrip } from "./api/trips.js"
import "./index.css"

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
    return "The planning server took too long to respond. Please try once more."
  }
  if (stage === "retrieve" && error?.status === 404) {
    return "This saved trip could not be found. It may have expired after a server redeploy."
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
    <header className="app-header">
      <button className="brand" onClick={onNewTrip} type="button">
        <span className="brand__mark" aria-hidden="true">
          <svg fill="none" viewBox="0 0 32 32">
            <path d="M6 23 12 9l5 10 4-8 5 12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.8" />
            <circle cx="6" cy="23" fill="currentColor" r="2.5" />
            <circle cx="26" cy="23" fill="currentColor" r="2.5" />
          </svg>
        </span>
        <span>
          <strong>Spotter</strong>
          <small>ELD Trip Planner</small>
        </span>
      </button>
      <div className="app-header__meta">
        <span className="ruleset-chip">Property carrier · 70/8</span>
        {showNewTrip && (
          <button className="header-action" onClick={onNewTrip} type="button">
            New trip
          </button>
        )}
      </div>
    </header>
  )
}

function PlannerIntro() {
  return (
    <aside className="planner-intro">
      <div className="planner-intro__visual" aria-hidden="true">
        <span className="visual-route" />
        <i className="visual-pin visual-pin--one">A</i>
        <i className="visual-pin visual-pin--two">B</i>
        <i className="visual-pin visual-pin--three">C</i>
        <div className="visual-card visual-card--hours">
          <small>Drive time</small>
          <strong>11:00</strong>
          <span><i style={{ width: "68%" }} /></span>
        </div>
        <div className="visual-card visual-card--log">
          <small>Daily logs</small>
          <strong>Auto-filled</strong>
          <span className="visual-log-lines" />
        </div>
      </div>
      <div className="planner-intro__copy">
        <p className="eyebrow eyebrow--light">Built for the road ahead</p>
        <h2>Route planning that understands your clock.</h2>
        <p>
          Get an HGV route, required fuel and rest stops, and complete daily
          log sheets in one plan.
        </p>
        <ul>
          <li><span>✓</span> 11-hour drive and 14-hour window limits</li>
          <li><span>✓</span> Required 30-minute breaks and 10-hour resets</li>
          <li><span>✓</span> Printable, shareable daily ELD logs</li>
        </ul>
      </div>
    </aside>
  )
}

function LoadingView({ message }) {
  return (
    <main className="loading-page" aria-live="polite">
      <div className="loading-card">
        <div className="route-loader" aria-hidden="true">
          <span>A</span>
          <i />
          <span>B</span>
          <i />
          <span>C</span>
        </div>
        <p className="eyebrow">Building your route</p>
        <h1>{message}</h1>
        <p>
          We’re geocoding the stops, routing the truck, applying HOS limits,
          and drawing each log day.
        </p>
        <div className="loading-progress"><span /></div>
      </div>
    </main>
  )
}

function SavedTripError({ message, onNewTrip, onRetry }) {
  return (
    <main className="error-page">
      <section className="empty-result">
        <span className="empty-result__icon" aria-hidden="true">!</span>
        <p className="eyebrow">Trip unavailable</p>
        <h1>We couldn’t open this trip</h1>
        <p>{message}</p>
        <div>
          <button className="primary-button" onClick={onRetry} type="button">Try again</button>
          <button className="outlined-button" onClick={onNewTrip} type="button">Plan a new trip</button>
        </div>
      </section>
    </main>
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

  const runRequest = useCallback(async (stage, operation) => {
    cancelActiveRequest()
    const controller = new AbortController()
    activeRequest.current = controller
    let timedOut = false

    const timeout = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, REQUEST_TIMEOUT_MS)
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
    } catch (error) {
      if (timedOut && error?.name === "AbortError") {
        error.timedOut = true
      }
      throw error
    } finally {
      window.clearTimeout(timeout)
      window.clearTimeout(wakeTimer)
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }, [cancelActiveRequest])

  const loadSavedTrip = useCallback(async (tripId) => {
    setView({
      name: "loading",
      message: "Loading your saved trip…",
      stage: "retrieve",
      tripId,
    })
    try {
      const snapshot = await runRequest("retrieve", (signal) =>
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
      message: "Planning your trip…",
      stage: "create",
      input,
    })
    try {
      const created = await runRequest("create", (signal) =>
        createTrip(API_BASE_URL, input, signal),
      )
      if (!mounted.current) return
      window.history.pushState({}, "", `/trips/${created.id}`)
      setView({
        name: "loading",
        message: "Loading your route and log sheets…",
        stage: "retrieve",
        tripId: created.id,
      })
      const snapshot = await runRequest("retrieve", (signal) =>
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
      window.prompt("Copy this shareable trip link:", url)
    }
    setShareStatus("copied")
    window.setTimeout(() => setShareStatus("idle"), 2_000)
  }

  return (
    <div className="app-shell">
      <AppHeader onNewTrip={newTrip} showNewTrip={view.name !== "planner"} />
      {view.name === "planner" && (
        <main className="planner-page">
          <div className="planner-layout">
            <TripForm
              busy={false}
              error={view.error}
              fieldErrors={view.fieldErrors}
              initialValues={view.initialValues}
              loadingMessage=""
              onSubmit={planTrip}
            />
            <PlannerIntro />
          </div>
          <p className="planner-disclaimer">
            Planning aid for property-carrying drivers. Review the generated
            route and logs before operating.
          </p>
        </main>
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
        <TripResults
          onNewTrip={newTrip}
          onShare={shareTrip}
          shareStatus={shareStatus}
          snapshot={view.snapshot}
        />
      )}
    </div>
  )
}
