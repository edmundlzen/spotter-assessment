import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import App from "./App.jsx"

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function response({ json = { status: "ok" }, ok = true, status = 200 } = {}) {
  return {
    json: vi.fn().mockResolvedValue(json),
    ok,
    status,
  }
}

async function expectFailure() {
  expect(await screen.findByText("Unable to connect to backend")).toBeTruthy()
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy()
}

describe("App", () => {
  let consoleError

  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test/")
    global.fetch = vi.fn()
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("starts one configured health request and shows only the connecting copy", () => {
    fetch.mockReturnValue(new Promise(() => {}))

    render(<App />)

    expect(screen.getByText("Connecting to backend...")).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.test/api/health/",
      { signal: expect.any(AbortSignal) },
    )
  })

  it("connects only for a successful response with the exact payload", async () => {
    fetch.mockResolvedValue(response())

    render(<App />)

    expect(await screen.findByText("Backend connected")).toBeTruthy()
    expect(screen.queryByText("Connecting to backend...")).toBeNull()
  })

  it.each([
    [
      "http",
      () => Promise.resolve(response({ ok: false, status: 503 })),
      "http",
    ],
    [
      "invalid json",
      () =>
        Promise.resolve({
          ...response(),
          json: vi.fn().mockRejectedValue(new SyntaxError("bad json")),
        }),
      "payload",
    ],
    [
      "wrong payload",
      () => Promise.resolve(response({ json: { status: "ok", extra: true } })),
      "payload",
    ],
    [
      "network/cors",
      () => Promise.reject(new TypeError("Failed to fetch")),
      "network/cors",
    ],
  ])("shows a generic failure and private %s diagnostic", async (_, result, category) => {
    fetch.mockImplementation(result)

    render(<App />)

    await expectFailure()
    expect(consoleError).toHaveBeenCalledWith(
      "Backend health check failed",
      expect.objectContaining({ category }),
    )
    expect(document.body.textContent).not.toContain("503")
    expect(document.body.textContent).not.toContain("Failed to fetch")
  })

  it("times out and aborts at exactly 75 seconds", async () => {
    vi.useFakeTimers()
    fetch.mockImplementation((_, { signal }) => {
      const request = deferred()
      signal.addEventListener("abort", () => {
        request.reject(new DOMException("Aborted", "AbortError"))
      })
      return request.promise
    })

    render(<App />)
    await act(() => vi.advanceTimersByTimeAsync(74_999))
    expect(screen.getByText("Connecting to backend...")).toBeTruthy()

    await act(() => vi.advanceTimersByTimeAsync(1))

    expect(screen.getByText("Unable to connect to backend")).toBeTruthy()
    expect(consoleError).toHaveBeenCalledWith(
      "Backend health check failed",
      { category: "timeout" },
    )
  })

  it("retries with a fresh signal and ignores a stale completion", async () => {
    const first = deferred()
    fetch
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(response())

    render(<App />)
    const firstSignal = fetch.mock.calls[0][1].signal

    first.reject(new TypeError("Failed to fetch"))
    await expectFailure()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))

    expect(screen.getByText("Connecting to backend...")).toBeTruthy()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const secondSignal = fetch.mock.calls[1][1].signal
    expect(secondSignal).not.toBe(firstSignal)
    expect(firstSignal.aborted).toBe(true)
    expect(await screen.findByText("Backend connected")).toBeTruthy()
  })

  it("aborts on unmount without showing or logging a failure", () => {
    fetch.mockReturnValue(new Promise(() => {}))
    const view = render(<App />)
    const signal = fetch.mock.calls[0][1].signal

    view.unmount()

    expect(signal.aborted).toBe(true)
    expect(consoleError).not.toHaveBeenCalled()
  })
})
