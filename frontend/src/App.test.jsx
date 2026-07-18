import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import App from "./App.jsx"
import { FIXED_TRIP, createTrip, getTrip } from "./api/trips.js"

const TRIP_ID = "87f2df41-a522-4e9c-8a79-36e728621a0a"

function response({ json, ok = true, status = 200 }) {
  return {
    json: vi.fn().mockResolvedValue(json),
    ok,
    status,
  }
}

function completeCreate() {
  return {
    id: TRIP_ID,
    summary: {
      total_distance_miles: 1548.25,
      total_duration_minutes: 1540,
      leg_count: 2,
      stop_count: 3,
      duty_segment_count: 9,
      log_day_count: 3,
    },
  }
}

function daySegments(date, drivingMinutes) {
  const drivingHours = drivingMinutes / 60
  const drivingEndHour = 10 + drivingHours
  const nextDate = new Date(`${date}T00:00:00Z`)
  nextDate.setUTCDate(nextDate.getUTCDate() + 1)
  const nextDateText = nextDate.toISOString().slice(0, 10)
  const timestamp = (hour) => {
    if (hour === 24) {
      return `${nextDateText}T00:00:00`
    }
    const wholeHours = Math.floor(hour)
    const minutes = Math.round((hour - wholeHours) * 60)
    return `${date}T${String(wholeHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`
  }

  return [
    {
      status: "off_duty",
      start: timestamp(0),
      end: timestamp(10),
      duration_minutes: 600,
      note: "",
    },
    {
      status: "driving",
      start: timestamp(10),
      end: timestamp(drivingEndHour),
      duration_minutes: drivingMinutes,
      note: "Route driving",
    },
    {
      status: "on_duty_not_driving",
      start: timestamp(drivingEndHour),
      end: timestamp(24),
      duration_minutes: 840 - drivingMinutes,
      note: "Other on-duty time",
    },
  ]
}

function completeSnapshot(id = TRIP_ID) {
  const logDayDefinitions = [
    ["2026-07-18", 600, 610.25],
    ["2026-07-19", 600, 604],
    ["2026-07-20", 340, 334],
  ]
  const logDays = logDayDefinitions.map(([date, drivingMinutes, totalMiles]) => {
    const segments = daySegments(date, drivingMinutes)
    return {
      date,
      total_miles: totalMiles,
      status_totals_minutes: {
        off_duty: 600,
        sleeper_berth: 0,
        driving: drivingMinutes,
        on_duty_not_driving: 840 - drivingMinutes,
      },
      segments,
    }
  })

  return {
    schema_version: 1,
    trip: {
      id,
      departure_local: "2026-07-18T08:00:00",
      departure_assumed: true,
      cycle_hours_used: 0,
    },
    locations: {
      current: {
        query: "New York, NY",
        label: "New York, NY, USA",
        coordinate: [-74.006, 40.7128],
      },
      pickup: {
        query: "Chicago, IL",
        label: "Chicago, IL, USA",
        coordinate: [-87.6298, 41.8781],
      },
      dropoff: {
        query: "Dallas, TX",
        label: "Dallas, TX, USA",
        coordinate: [-96.797, 32.7767],
      },
    },
    route: {
      profile: "driving-hgv",
      total_distance_miles: 1548.25,
      total_duration_minutes: 1540,
      legs: [
        {
          from: "current",
          to: "pickup",
          distance_miles: 790,
          duration_minutes: 750,
        },
        {
          from: "pickup",
          to: "dropoff",
          distance_miles: 758.25,
          duration_minutes: 790,
        },
      ],
      geometry: {
        type: "LineString",
        coordinates: [
          [-74.006, 40.7128],
          [-87.6298, 41.8781],
          [-96.797, 32.7767],
        ],
      },
    },
    stops: [
      {
        kind: "pickup",
        cumulative_miles: 790,
        coordinate: [-87.6298, 41.8781],
        start: "2026-07-18T20:30:00",
        end: "2026-07-18T21:30:00",
        status: "on_duty_not_driving",
        note: "",
      },
      {
        kind: "fuel",
        cumulative_miles: 1000,
        coordinate: [-90.25, 39.7],
        start: "2026-07-19T08:00:00",
        end: "2026-07-19T08:30:00",
        status: "on_duty_not_driving",
        note: "Fuel stop",
      },
      {
        kind: "dropoff",
        cumulative_miles: 1548.25,
        coordinate: [-96.797, 32.7767],
        start: "2026-07-20T14:40:00",
        end: "2026-07-20T15:40:00",
        status: "on_duty_not_driving",
        note: "Dropoff",
      },
    ],
    duty_segments: logDays.flatMap((day) =>
      day.segments.map((segment) => ({ ...segment })),
    ),
    log_days: logDays,
    summary: completeCreate().summary,
  }
}

function invalidSnapshot(name, mutate) {
  const snapshot = completeSnapshot()
  mutate(snapshot)
  return [name, snapshot]
}

const invalidStoredSnapshots = [
  invalidSnapshot("schema_version", (snapshot) => {
    snapshot.schema_version = 2
  }),
  invalidSnapshot("trip.id", (snapshot) => {
    snapshot.trip.id = "not-a-uuid"
  }),
  invalidSnapshot("trip.id UUID continuity", (snapshot) => {
    snapshot.trip.id = "ea20e9cb-c605-4f36-8d07-90be33092e8a"
  }),
  invalidSnapshot("trip.departure_local", (snapshot) => {
    snapshot.trip.departure_local = "2026-07-18T08:00:00Z"
  }),
  invalidSnapshot("trip.departure_assumed", (snapshot) => {
    snapshot.trip.departure_assumed = "true"
  }),
  invalidSnapshot("trip.cycle_hours_used", (snapshot) => {
    snapshot.trip.cycle_hours_used = Number.NaN
  }),
  ...["current", "pickup", "dropoff"].flatMap((role) => [
    invalidSnapshot(`locations.${role}.query`, (snapshot) => {
      snapshot.locations[role].query = " "
    }),
    invalidSnapshot(`locations.${role}.label`, (snapshot) => {
      snapshot.locations[role].label = ""
    }),
    invalidSnapshot(`locations.${role}.coordinate[0]`, (snapshot) => {
      snapshot.locations[role].coordinate[0] = 181
    }),
    invalidSnapshot(`locations.${role}.coordinate[1]`, (snapshot) => {
      snapshot.locations[role].coordinate[1] = -91
    }),
  ]),
  invalidSnapshot("route.profile", (snapshot) => {
    snapshot.route.profile = "driving-car"
  }),
  invalidSnapshot("route.total_distance_miles", (snapshot) => {
    snapshot.route.total_distance_miles = -1
  }),
  invalidSnapshot("route.total_duration_minutes", (snapshot) => {
    snapshot.route.total_duration_minutes = 0
  }),
  ...[0, 1].flatMap((index) => [
    invalidSnapshot(`route.legs[${index}].from`, (snapshot) => {
      snapshot.route.legs[index].from = "dropoff"
    }),
    invalidSnapshot(`route.legs[${index}].to`, (snapshot) => {
      snapshot.route.legs[index].to = "current"
    }),
    invalidSnapshot(`route.legs[${index}].distance_miles`, (snapshot) => {
      snapshot.route.legs[index].distance_miles = -1
    }),
    invalidSnapshot(`route.legs[${index}].duration_minutes`, (snapshot) => {
      snapshot.route.legs[index].duration_minutes = 0
    }),
  ]),
  invalidSnapshot("route.geometry.type", (snapshot) => {
    snapshot.route.geometry.type = "Point"
  }),
  invalidSnapshot("route.geometry.coordinates cardinality", (snapshot) => {
    snapshot.route.geometry.coordinates = [[-74.006, 40.7128]]
  }),
  invalidSnapshot("route.geometry.coordinates longitude", (snapshot) => {
    snapshot.route.geometry.coordinates[1][0] = Number.POSITIVE_INFINITY
  }),
  invalidSnapshot("route.geometry.coordinates latitude", (snapshot) => {
    snapshot.route.geometry.coordinates[1][1] = 91
  }),
  invalidSnapshot("stops[0].kind", (snapshot) => {
    snapshot.stops[0].kind = ""
  }),
  invalidSnapshot("stops[0].cumulative_miles", (snapshot) => {
    snapshot.stops[0].cumulative_miles = -1
  }),
  invalidSnapshot("stops[0].coordinate[0]", (snapshot) => {
    snapshot.stops[0].coordinate[0] = 181
  }),
  invalidSnapshot("stops[0].coordinate[1]", (snapshot) => {
    snapshot.stops[0].coordinate[1] = 91
  }),
  invalidSnapshot("stops[0].start", (snapshot) => {
    snapshot.stops[0].start = "not-a-timestamp"
  }),
  invalidSnapshot("stops[0].end", (snapshot) => {
    snapshot.stops[0].end = "2026-07-18T20:00:00"
  }),
  invalidSnapshot("stops[0].status", (snapshot) => {
    snapshot.stops[0].status = "resting"
  }),
  invalidSnapshot("stops[0].note", (snapshot) => {
    snapshot.stops[0].note = null
  }),
  invalidSnapshot("duty_segments[0].status", (snapshot) => {
    snapshot.duty_segments[0].status = "resting"
  }),
  invalidSnapshot("duty_segments[0].start", (snapshot) => {
    snapshot.duty_segments[0].start = "2026-07-18T00:00:00Z"
  }),
  invalidSnapshot("duty_segments[0].end", (snapshot) => {
    snapshot.duty_segments[0].end = "2026-07-18T00:00:00"
  }),
  invalidSnapshot("duty_segments[0].duration_minutes", (snapshot) => {
    snapshot.duty_segments[0].duration_minutes = 0
  }),
  invalidSnapshot("duty_segments[0].note", (snapshot) => {
    snapshot.duty_segments[0].note = false
  }),
  invalidSnapshot("log_days[0].date", (snapshot) => {
    snapshot.log_days[0].date = "2026-02-30"
  }),
  invalidSnapshot("log_days[0].total_miles", (snapshot) => {
    snapshot.log_days[0].total_miles = -1
  }),
  ...["off_duty", "sleeper_berth", "driving", "on_duty_not_driving"].flatMap(
    (status) => [
      invalidSnapshot(
        `log_days[0].status_totals_minutes.${status} key`,
        (snapshot) => {
          delete snapshot.log_days[0].status_totals_minutes[status]
        },
      ),
      invalidSnapshot(
        `log_days[0].status_totals_minutes.${status} value`,
        (snapshot) => {
          snapshot.log_days[0].status_totals_minutes[status] = -1
        },
      ),
    ],
  ),
  invalidSnapshot("log_days[0] status total", (snapshot) => {
    snapshot.log_days[0].status_totals_minutes.off_duty = 599
  }),
  invalidSnapshot("log_days[0].segments[0].status", (snapshot) => {
    snapshot.log_days[0].segments[0].status = "resting"
  }),
  invalidSnapshot("log_days[0].segments[0].start", (snapshot) => {
    snapshot.log_days[0].segments[0].start = "not-a-timestamp"
  }),
  invalidSnapshot("log_days[0].segments[0].end", (snapshot) => {
    snapshot.log_days[0].segments[0].end = "2026-07-18T00:00:00"
  }),
  invalidSnapshot("log_days[0].segments[0].duration_minutes", (snapshot) => {
    snapshot.log_days[0].segments[0].duration_minutes = -1
  }),
  invalidSnapshot("log_days[0].segments[0].note", (snapshot) => {
    snapshot.log_days[0].segments[0].note = 42
  }),
  ...[
    "total_distance_miles",
    "total_duration_minutes",
    "leg_count",
    "stop_count",
    "duty_segment_count",
    "log_day_count",
  ].map((field) =>
    invalidSnapshot(`summary.${field}`, (snapshot) => {
      snapshot.summary[field] = undefined
    }),
  ),
]

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe("trip API client", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("posts the immutable New York to Chicago to Dallas fixture to Django", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response({ json: completeCreate(), status: 201 }))
    const signal = new AbortController().signal

    await expect(createTrip("https://api.example.test/", signal)).resolves.toEqual(
      completeCreate(),
    )

    expect(FIXED_TRIP).toEqual({
      current_location: "New York, NY",
      pickup_location: "Chicago, IL",
      dropoff_location: "Dallas, TX",
      cycle_hours_used: 0,
    })
    expect(Object.isFrozen(FIXED_TRIP)).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/trips/",
      {
        body: JSON.stringify(FIXED_TRIP),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal,
      },
    )
  })

  it("retrieves only the exact UUID and returns a complete matching snapshot", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response({ json: completeSnapshot() }))
    const signal = new AbortController().signal

    await expect(
      getTrip("https://api.example.test///", TRIP_ID, signal),
    ).resolves.toEqual(completeSnapshot())
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.test/api/trips/${TRIP_ID}/`,
      { signal },
    )
  })

  it.each([
    ["HTTP failure", response({ json: {}, ok: false, status: 503 })],
    ["invalid JSON", { json: vi.fn().mockRejectedValue(new SyntaxError()) }],
    ["missing UUID", response({ json: { summary: completeCreate().summary } })],
    [
      "missing summary fact",
      response({
        json: {
          ...completeCreate(),
          summary: { ...completeCreate().summary, stop_count: undefined },
        },
      }),
    ],
  ])("categorizes an invalid create response: %s", async (_, result) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(result)

    await expect(
      createTrip("https://api.example.test", new AbortController().signal),
    ).rejects.toMatchObject({ category: "create" })
  })

  it.each([
    ["HTTP failure", response({ json: {}, ok: false, status: 404 })],
    ["invalid JSON", { json: vi.fn().mockRejectedValue(new SyntaxError()) }],
  ])("categorizes an unavailable retrieved record: %s", async (_, result) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(result)

    await expect(
      getTrip(
        "https://api.example.test",
        TRIP_ID,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ category: "retrieve" })
  })

  it.each(invalidStoredSnapshots)(
    "rejects an incomplete stored snapshot leaf: %s",
    async (_, snapshot) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ json: snapshot }))

      await expect(
        getTrip(
          "https://api.example.test",
          TRIP_ID,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ category: "retrieve" })
    },
  )

  it("accepts an empty ordered stop collection only with a matching zero count", async () => {
    const snapshot = completeSnapshot()
    snapshot.stops = []
    snapshot.summary.stop_count = 0
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ json: snapshot }))

    await expect(
      getTrip(
        "https://api.example.test",
        TRIP_ID,
        new AbortController().signal,
      ),
    ).resolves.toEqual(snapshot)
  })
})

describe("fixed trip persistence proof", () => {
  let consoleError

  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test/")
    globalThis.fetch = vi.fn()
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("starts idle with exact empty copy and no progress or record", () => {
    render(<App />)

    expect(screen.getByText("No trip record yet")).toBeTruthy()
    expect(
      screen.getByText(
        "Process the test trip to verify routing, scheduling, and persistence.",
      ),
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Process test trip" }).disabled,
    ).toBe(false)
    expect(screen.queryByTestId("progress-indicator")).toBeNull()
    expect(screen.queryByLabelText("Stored trip facts")).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("creates once, retrieves the returned UUID, and renders seven ordered facts", async () => {
    const createRequest = deferred()
    const retrieveRequest = deferred()
    fetch
      .mockReturnValueOnce(createRequest.promise)
      .mockReturnValueOnce(retrieveRequest.promise)

    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "Process test trip" }))

    expect(
      screen.getByRole("button", { name: "Processing trip…" }).disabled,
    ).toBe(true)
    expect(
      screen.getByTestId("progress-indicator").getAttribute("aria-hidden"),
    ).toBe("true")
    expect(screen.queryByText("No trip record yet")).toBeNull()

    await act(async () => {
      createRequest.resolve(
        response({ json: completeCreate(), status: 201 }),
      )
    })

    expect(
      screen.getByRole("button", { name: "Loading stored trip…" }).disabled,
    ).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][0]).toBe(
      `https://api.example.test/api/trips/${TRIP_ID}/`,
    )
    expect(screen.getAllByText("Loading stored trip…")).toHaveLength(2)
    expect(screen.queryByText("Stored result loaded")).toBeNull()
    const pendingList = screen.getByLabelText("Stored trip facts")
    expect(
      [...pendingList.querySelectorAll("dt")].map((term) => term.textContent),
    ).toEqual([
      "Record ID",
      "Distance",
      "Duration",
      "Legs",
      "Stops",
      "Duty segments",
      "Log days",
    ])
    expect(
      [...pendingList.querySelectorAll("dd")].map(
        (value) => value.textContent,
      ),
    ).toEqual([TRIP_ID, "1548.25 miles", "1540 minutes", "2", "3", "9", "3"])

    await act(async () => {
      retrieveRequest.resolve(response({ json: completeSnapshot() }))
    })

    expect(screen.getByText("Stored result loaded")).toBeTruthy()
    const list = screen.getByLabelText("Stored trip facts")
    expect(
      [...list.querySelectorAll("dt")].map((term) => term.textContent),
    ).toEqual([
      "Record ID",
      "Distance",
      "Duration",
      "Legs",
      "Stops",
      "Duty segments",
      "Log days",
    ])
    expect(
      [...list.querySelectorAll("dd")].map((value) => value.textContent),
    ).toEqual([TRIP_ID, "1548.25 miles", "1540 minutes", "2", "3", "9", "3"])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    [
      "create",
      () => [response({ json: {}, ok: false, status: 503 })],
      "We couldn't create the trip record. Check the routing service and try again.",
    ],
    [
      "retrieve",
      () => [
        response({ json: completeCreate(), status: 201 }),
        response({ json: {}, ok: false, status: 404 }),
      ],
      "This trip record is unavailable. Verify the UUID and try again.",
    ],
    [
      "incomplete retrieve",
      () => {
        const snapshot = completeSnapshot()
        snapshot.route.profile = "driving-car"
        return [
          response({ json: completeCreate(), status: 201 }),
          response({ json: snapshot }),
        ]
      },
      "This trip record is unavailable. Verify the UUID and try again.",
    ],
  ])("shows exact actionable %s failure copy with a retry", async (_, results, copy) => {
    for (const result of results()) {
      fetch.mockResolvedValueOnce(result)
    }

    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "Process test trip" }))

    expect(await screen.findByText(copy)).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Process test trip" }).disabled,
    ).toBe(false)
    expect(screen.queryByLabelText("Stored trip facts")).toBeNull()
    expect(document.body.textContent).not.toMatch(/503|404|api\.example|stack/i)
    expect(consoleError).toHaveBeenCalledWith(
      "Trip proof request failed",
      expect.objectContaining({ category: expect.any(String) }),
    )
  })

  it("uses a fresh signal for retry and prevents duplicate in-flight activation", async () => {
    const first = deferred()
    const retry = deferred()
    fetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise)

    render(<App />)
    const action = screen.getByRole("button", { name: "Process test trip" })
    fireEvent.click(action)
    fireEvent.click(screen.getByRole("button", { name: "Processing trip…" }))
    expect(fetch).toHaveBeenCalledTimes(1)
    const firstSignal = fetch.mock.calls[0][1].signal

    await act(async () => {
      first.reject(new TypeError("network detail"))
    })
    fireEvent.click(screen.getByRole("button", { name: "Process test trip" }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))

    expect(firstSignal.aborted).toBe(true)
    expect(fetch.mock.calls[1][1].signal).not.toBe(firstSignal)
  })

  it("times out at 75 seconds and aborts without exposing technical detail", async () => {
    vi.useFakeTimers()
    fetch.mockImplementation((_, { signal }) => {
      const request = deferred()
      signal.addEventListener("abort", () => {
        request.reject(new DOMException("Aborted", "AbortError"))
      })
      return request.promise
    })

    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "Process test trip" }))
    await act(() => vi.advanceTimersByTimeAsync(74_999))
    expect(
      screen.getByRole("button", { name: "Processing trip…" }).disabled,
    ).toBe(true)

    await act(() => vi.advanceTimersByTimeAsync(1))

    expect(
      screen.getByText(
        "We couldn't create the trip record. Check the routing service and try again.",
      ),
    ).toBeTruthy()
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
    expect(document.body.textContent).not.toContain("AbortError")
  })

  it("aborts on unmount and suppresses stale completion and diagnostics", async () => {
    const request = deferred()
    fetch.mockReturnValue(request.promise)
    const view = render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "Process test trip" }))
    const signal = fetch.mock.calls[0][1].signal

    view.unmount()
    await act(async () => {
      request.resolve(response({ json: completeCreate(), status: 201 }))
    })

    expect(signal.aborted).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(consoleError).not.toHaveBeenCalled()
  })
})
