import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./components/TripResults.jsx", () => ({
  default: ({ snapshot }) => (
    <main aria-label="Rendered trip">
      <h1>Trip results</h1>
      <span>{snapshot.trip.id}</span>
      <span>{snapshot.summary.total_distance_miles} miles</span>
    </main>
  ),
}))

import App from "./App.jsx"
import {
  createTrip,
  getTrip,
  searchLocations,
} from "./api/trips.js"
import {
  calculateHosBalances,
  formatDurationAsHours,
} from "./utils/trip.js"
import TripForm from "./components/TripForm.jsx"
import EldLogSheets from "./components/EldLogSheet.jsx"

const TRIP_ID = "87f2df41-a522-4e9c-8a79-36e728621a0a"
const INPUT = {
  current_location: "New York, NY",
  pickup_location: "Chicago, IL",
  dropoff_location: "Dallas, TX",
  cycle_hours_used: 0,
}

function response(json, { ok = true, status = 200 } = {}) {
  return {
    json: vi.fn().mockResolvedValue(json),
    ok,
    status,
  }
}

function snapshot() {
  const segments = [
    {
      status: "off_duty",
      start: "2026-07-18T00:00:00",
      end: "2026-07-18T08:00:00",
      duration_minutes: 480,
      note: "outside trip",
    },
    {
      status: "driving",
      start: "2026-07-18T08:00:00",
      end: "2026-07-18T10:00:00",
      duration_minutes: 120,
      note: "Route driving",
    },
    {
      status: "on_duty_not_driving",
      start: "2026-07-18T10:00:00",
      end: "2026-07-18T12:00:00",
      duration_minutes: 120,
      note: "Pickup and drop-off",
    },
    {
      status: "off_duty",
      start: "2026-07-18T12:00:00",
      end: "2026-07-19T00:00:00",
      duration_minutes: 720,
      note: "outside trip",
    },
  ]

  return {
    schema_version: 1,
    trip: {
      id: TRIP_ID,
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
      total_distance_miles: 200,
      total_duration_minutes: 240,
      legs: [
        {
          from: "current",
          to: "pickup",
          distance_miles: 100,
          duration_minutes: 120,
        },
        {
          from: "pickup",
          to: "dropoff",
          distance_miles: 100,
          duration_minutes: 120,
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
        cumulative_miles: 100,
        coordinate: [-87.6298, 41.8781],
        start: "2026-07-18T10:00:00",
        end: "2026-07-18T11:00:00",
        status: "on_duty_not_driving",
        note: "Pickup service",
      },
      {
        kind: "dropoff",
        cumulative_miles: 200,
        coordinate: [-96.797, 32.7767],
        start: "2026-07-18T11:00:00",
        end: "2026-07-18T12:00:00",
        status: "on_duty_not_driving",
        note: "Drop-off service",
      },
    ],
    duty_segments: segments,
    log_days: [
      {
        date: "2026-07-18",
        total_miles: 200,
        status_totals_minutes: {
          off_duty: 1200,
          sleeper_berth: 0,
          driving: 120,
          on_duty_not_driving: 120,
        },
        segments,
      },
    ],
    summary: {
      total_distance_miles: 200,
      total_duration_minutes: 240,
      leg_count: 2,
      stop_count: 2,
      duty_segment_count: 4,
      log_day_count: 1,
    },
  }
}

function createdTrip() {
  return { id: TRIP_ID, summary: snapshot().summary }
}

describe("trip API client", () => {
  afterEach(() => vi.restoreAllMocks())

  it("posts the entered trip and retrieves its complete snapshot", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response(createdTrip(), { status: 201 }))
      .mockResolvedValueOnce(response(snapshot()))
    const createSignal = new AbortController().signal
    const getSignal = new AbortController().signal

    await expect(
      createTrip("https://api.example.test/", INPUT, createSignal),
    ).resolves.toEqual(createdTrip())
    await expect(
      getTrip("https://api.example.test/", TRIP_ID, getSignal),
    ).resolves.toEqual(snapshot())

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.example.test/api/trips/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(INPUT),
        signal: createSignal,
      },
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `https://api.example.test/api/trips/${TRIP_ID}/`,
      { signal: getSignal },
    )
  })

  it("keeps backend field errors available to the form", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response(
        { current_location: ["Choose a more specific location."] },
        { ok: false, status: 400 },
      ),
    )

    await expect(
      createTrip("", INPUT, new AbortController().signal),
    ).rejects.toMatchObject({
      category: "create",
      details: {
        current_location: ["Choose a more specific location."],
      },
      status: 400,
    })
  })

  it("retrieves bounded location suggestions through the Django API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response({
        results: [
          {
            label: "Chicago, Cook County, Illinois, USA",
            coordinate: [-87.6298, 41.8781],
          },
        ],
      }),
    )

    await expect(
      searchLocations(
        "https://api.example.test/",
        " Chicago ",
        new AbortController().signal,
      ),
    ).resolves.toEqual([
      {
        label: "Chicago, Cook County, Illinois, USA",
        coordinate: [-87.6298, 41.8781],
      },
    ])
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.test/api/locations/?q=Chicago",
      { signal: expect.any(AbortSignal) },
    )
  })
})

describe("duration formatting", () => {
  it("keeps long HOS balances in total hours", () => {
    expect(formatDurationAsHours(1_617)).toBe("26h 57m")
    expect(formatDurationAsHours(660)).toBe("11h")
  })

  it("keeps used and remaining time tied to each legal limit", () => {
    const balances = calculateHosBalances(snapshot())

    for (const key of ["driving", "window", "cycle"]) {
      expect(balances[key].used + balances[key].remaining).toBe(
        balances[key].limit,
      )
    }
  })
})

describe("location autocomplete", () => {
  it("searches after typing and applies the selected suggestion", async () => {
    const onSearchLocations = vi.fn().mockResolvedValue([
      {
        label: "Chicago, Cook County, Illinois, USA",
        coordinate: [-87.6298, 41.8781],
      },
    ])

    render(
      <TripForm
        busy={false}
        loadingMessage=""
        onSearchLocations={onSearchLocations}
        onSubmit={vi.fn()}
      />,
    )

    fireEvent.change(
      screen.getByRole("combobox", { name: "Current location" }),
      { target: { value: "Chic" } },
    )

    expect(
      await screen.findByRole("option", {
        name: "Chicago, Cook County, Illinois, USA",
      }),
    ).toBeTruthy()
    expect(onSearchLocations).toHaveBeenCalledWith(
      "Chic",
      expect.any(AbortSignal),
    )

    fireEvent.click(
      screen.getByRole("option", {
        name: "Chicago, Cook County, Illinois, USA",
      }),
    )
    expect(
      screen.getByRole("combobox", { name: "Current location" }).value,
    ).toBe("Chicago, Cook County, Illinois, USA")
  })
})

describe("trip planner", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/")
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("opens as the real trip form without making a request", () => {
    render(<App />)

    expect(screen.getByText("Route planning & driver logs")).toBeTruthy()
    expect(screen.queryByText(/Property carrier/)).toBeNull()
    expect(screen.queryByText(/Routing and geocoding/)).toBeNull()
    expect(
      screen.getByRole("heading", { name: "Plan a trip" }),
    ).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Current location" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Plan my trip" })).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("validates required route locations before contacting the backend", () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Plan my trip" }))

    expect(screen.getAllByText(/is required\./)).toHaveLength(3)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("plans the sample trip, loads the stored result, and creates its share URL", async () => {
    fetch
      .mockResolvedValueOnce(response(createdTrip(), { status: 201 }))
      .mockResolvedValueOnce(response(snapshot()))
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Use sample trip" }))
    expect(screen.getByRole("combobox", { name: "Current location" }).value).toBe(
      "New York, NY",
    )
    fireEvent.click(screen.getByRole("button", { name: "Plan my trip" }))

    expect(
      screen.getByRole("heading", { name: "Planning trip…" }),
    ).toBeTruthy()
    expect(
      await screen.findByRole("heading", { name: "Trip results" }),
    ).toBeTruthy()
    expect(window.location.pathname).toBe(`/trips/${TRIP_ID}`)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(INPUT)
  })

  it("shows backend field guidance without clearing the entered route", async () => {
    fetch.mockResolvedValueOnce(
      response(
        { current_location: ["Choose a more specific location."] },
        { ok: false, status: 400 },
      ),
    )
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Use sample trip" }))
    fireEvent.click(screen.getByRole("button", { name: "Plan my trip" }))

    expect(
      await screen.findByText("Choose a more specific location."),
    ).toBeTruthy()
    expect(screen.getByRole("combobox", { name: /Current location/ }).value).toBe(
      "New York, NY",
    )
  })

  it("loads a shareable trip URL directly without creating another trip", async () => {
    window.history.replaceState({}, "", `/trips/${TRIP_ID}`)
    fetch.mockResolvedValueOnce(response(snapshot()))

    render(<App />)

    expect(
      await screen.findByRole("heading", { name: "Trip results" }),
    ).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toContain(`/api/trips/${TRIP_ID}/`)
    expect(fetch.mock.calls[0][1].method).toBeUndefined()
  })
})

describe("daily ELD log", () => {
  it("draws a complete HTML paper log with trip data and duty lines", () => {
    const { container } = render(<EldLogSheets snapshot={snapshot()} />)

    expect(
      screen.getByLabelText("Filled driver's daily log for July 18, 2026"),
    ).toBeTruthy()
    expect(container.querySelector(".eld-paper img")).toBeNull()
    expect(screen.getByText("Drivers Daily Log")).toBeTruthy()
    expect(container.querySelectorAll(".paper-log__tick")).toHaveLength(97)
    expect(container.querySelectorAll(".paper-log__status-line")).toHaveLength(4)
    expect(container.querySelector(".paper-log").textContent).toContain(
      "New York, NY, USA",
    )
    expect(container.querySelector(".paper-log").textContent).toContain(
      "Dallas, TX, USA",
    )
  })

  it("creates one complete paper sheet for every trip day", () => {
    const multiDay = snapshot()
    const nextDay = {
      ...multiDay.log_days[0],
      date: "2026-07-19",
      total_miles: 0,
      segments: [
        {
          status: "off_duty",
          start: "2026-07-19T00:00:00",
          end: "2026-07-20T00:00:00",
          duration_minutes: 1440,
          note: "outside trip",
        },
      ],
      status_totals_minutes: {
        off_duty: 1440,
        sleeper_berth: 0,
        driving: 0,
        on_duty_not_driving: 0,
      },
    }
    multiDay.log_days.push(nextDay)

    const { container } = render(<EldLogSheets snapshot={multiDay} />)

    expect(screen.getAllByTestId("eld-paper-log")).toHaveLength(2)
    expect(screen.getAllByTestId("eld-log-form")).toHaveLength(2)
    expect(container.querySelectorAll(".paper-log")).toHaveLength(2)
    expect(screen.getByRole("tab", { name: /Day 2/ })).toBeTruthy()
  })
})
