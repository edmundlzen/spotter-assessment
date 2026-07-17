import { useEffect, useState } from "react"

const TIMEOUT_MS = 75_000

class HealthError extends Error {
  constructor(category, context = {}) {
    super(`Backend health check failed: ${category}`)
    this.category = category
    this.context = context
  }
}

async function checkBackend(baseUrl, signal) {
  const response = await fetch(`${baseUrl}/api/health/`, { signal })

  if (!response.ok) {
    throw new HealthError("http", { status: response.status })
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new HealthError("payload")
  }

  const isExactPayload =
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    Object.keys(payload).length === 1 &&
    payload.status === "ok"

  if (!isExactPayload) {
    throw new HealthError("payload")
  }
}

function logFailure(category, context = {}) {
  console.error("Backend health check failed", { category, ...context })
}

export default function App() {
  const [attempt, setAttempt] = useState(0)
  const [connectionState, setConnectionState] = useState("connecting")

  useEffect(() => {
    const controller = new AbortController()
    const baseUrl = import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "")
    let active = true
    let timedOut = false

    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, TIMEOUT_MS)

    async function connect() {
      try {
        await checkBackend(baseUrl, controller.signal)
        if (active) {
          setConnectionState("connected")
        }
      } catch (error) {
        if (!active) {
          return
        }

        if (timedOut) {
          logFailure("timeout")
        } else if (error instanceof HealthError) {
          logFailure(error.category, error.context)
        } else if (error?.name === "AbortError") {
          return
        } else {
          logFailure("network/cors")
        }
        setConnectionState("failed")
      } finally {
        clearTimeout(timeout)
      }
    }

    connect()

    return () => {
      active = false
      clearTimeout(timeout)
      controller.abort()
    }
  }, [attempt])

  if (connectionState === "connected") {
    return <p>Backend connected</p>
  }

  if (connectionState === "failed") {
    return (
      <>
        <p>Unable to connect to backend</p>
        <button
          type="button"
          onClick={() => {
            setConnectionState("connecting")
            setAttempt((currentAttempt) => currentAttempt + 1)
          }}
        >
          Retry
        </button>
      </>
    )
  }

  return <p>Connecting to backend...</p>
}
