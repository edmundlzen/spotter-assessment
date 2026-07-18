import { useEffect, useRef, useState } from "react"

import { createTrip, getTrip } from "./api/trips.js"
import "./index.css"

const TIMEOUT_MS = 75_000

const CREATE_ERROR =
  "We couldn't create the trip record. Check the routing service and try again."
const RETRIEVE_ERROR =
  "This trip record is unavailable. Verify the UUID and try again."

function LoadingIndicator() {
  return (
    <span
      aria-hidden="true"
      className="progress-indicator"
      data-testid="progress-indicator"
      role="progressbar"
    />
  )
}

function Status({ state }) {
  if (state.name === "idle") {
    return (
      <div className="status-card">
        <h2>No trip record yet</h2>
        <p>
          Process the test trip to verify routing, scheduling, and persistence.
        </p>
      </div>
    )
  }

  if (state.name === "processing") {
    return (
      <div className="status-card status-card--loading">
        <h2>Processing trip…</h2>
      </div>
    )
  }

  if (state.name === "retrieving") {
    return (
      <>
        <div className="status-card status-card--loading">
          <h2>Loading stored trip…</h2>
        </div>
        <RecordCard record={state.created} />
      </>
    )
  }

  if (state.name === "create-failed" || state.name === "retrieve-failed") {
    return (
      <div className="status-card status-card--error">
        <h2>{state.name === "create-failed" ? CREATE_ERROR : RETRIEVE_ERROR}</h2>
      </div>
    )
  }

  return (
    <>
      <div className="status-card status-card--success">
        <h2>Stored result loaded</h2>
      </div>
      <RecordCard
        record={{ id: state.snapshot.trip.id, summary: state.snapshot.summary }}
      />
    </>
  )
}

function RecordCard({ record }) {
  const { id, summary } = record
  const facts = [
    ["Record ID", id, "record-id"],
    ["Distance", `${summary.total_distance_miles} miles`],
    ["Duration", `${summary.total_duration_minutes} minutes`],
    ["Legs", summary.leg_count],
    ["Stops", summary.stop_count],
    ["Duty segments", summary.duty_segment_count],
    ["Log days", summary.log_day_count],
  ]

  return (
    <div className="record-card">
      <dl aria-label="Stored trip facts" className="fact-list">
        {facts.map(([label, value, className]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={className}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export default function App() {
  const [state, setState] = useState({ name: "idle" })
  const mounted = useRef(true)
  const sequence = useRef(0)
  const activeRequest = useRef(null)

  useEffect(
    () => () => {
      mounted.current = false
      sequence.current += 1
      activeRequest.current?.abort()
      activeRequest.current = null
    },
    [],
  )

  async function processTrip() {
    if (activeRequest.current) {
      return
    }

    const requestNumber = ++sequence.current
    const controller = new AbortController()
    activeRequest.current = controller
    let stage = "create"
    let timedOut = false
    setState({ name: "processing" })

    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, TIMEOUT_MS)

    try {
      const baseUrl = import.meta.env.VITE_API_BASE_URL
      const created = await createTrip(baseUrl, controller.signal)
      if (!mounted.current || sequence.current !== requestNumber) {
        return
      }

      stage = "retrieve"
      setState({ name: "retrieving", created })
      const snapshot = await getTrip(baseUrl, created.id, controller.signal)
      if (!mounted.current || sequence.current !== requestNumber) {
        return
      }

      setState({ name: "success", snapshot })
    } catch (error) {
      if (!mounted.current || sequence.current !== requestNumber) {
        return
      }
      if (error?.name === "AbortError" && !timedOut) {
        return
      }

      const category = timedOut ? `${stage}-timeout` : error?.category || stage
      console.error("Trip proof request failed", { category })
      setState({ name: `${stage}-failed` })
    } finally {
      clearTimeout(timeout)
      if (sequence.current === requestNumber) {
        activeRequest.current = null
      }
      controller.abort()
    }
  }

  const loading = state.name === "processing" || state.name === "retrieving"
  const actionCopy =
    state.name === "processing"
      ? "Processing trip…"
      : state.name === "retrieving"
        ? "Loading stored trip…"
        : "Process test trip"

  return (
    <main className="proof-page">
      <section className="proof-panel" aria-labelledby="proof-title">
        <p className="proof-eyebrow">Routing and persistence</p>
        <h1 className="proof-heading" id="proof-title">
          Trip persistence proof
        </h1>
        <p className="proof-description">
          Create one fixed test trip, then load the complete stored record from
          Django.
        </p>

        <button
          className="proof-action"
          disabled={loading}
          onClick={processTrip}
          type="button"
        >
          {loading && <LoadingIndicator />}
          <span>{actionCopy}</span>
        </button>

        <div aria-live="polite" className="status-region">
          <Status state={state} />
        </div>
      </section>
    </main>
  )
}
