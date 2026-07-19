export const FIXED_TRIP = Object.freeze({
  current_location: "New York, NY",
  pickup_location: "Chicago, IL",
  dropoff_location: "Dallas, TX",
  cycle_hours_used: 0,
})

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const DUTY_STATUSES = [
  "off_duty",
  "sleeper_berth",
  "driving",
  "on_duty_not_driving",
]

const LOCATION_ROLES = ["current", "pickup", "dropoff"]

export class TripApiError extends Error {
  constructor(category, details = null, status = null) {
    super("Trip request failed")
    this.category = category
    this.details = details
    this.status = status
  }
}

function normalizeBaseUrl(baseUrl) {
  return (baseUrl ?? "").replace(/\/+$/, "")
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
}

function isNonblankString(value) {
  return typeof value === "string" && value.trim().length > 0
}

function isCoordinate(value) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1]) &&
    value[1] >= -90 &&
    value[1] <= 90
  )
}

function isDutyStatus(value) {
  return DUTY_STATUSES.includes(value)
}

function isValidSegment(segment) {
  return (
    isObject(segment) &&
    isDutyStatus(segment.status) &&
    isNonblankString(segment.start) &&
    isNonblankString(segment.end) &&
    isFiniteNumber(segment.duration_minutes) &&
    typeof segment.note === "string"
  )
}

function isValidLocation(location) {
  return (
    isObject(location) &&
    isNonblankString(location.query) &&
    isNonblankString(location.label) &&
    isCoordinate(location.coordinate)
  )
}

function isValidLeg(leg) {
  return (
    isObject(leg) &&
    isNonblankString(leg.from) &&
    isNonblankString(leg.to) &&
    isFiniteNumber(leg.distance_miles) &&
    isFiniteNumber(leg.duration_minutes)
  )
}

function isValidStop(stop) {
  return (
    isObject(stop) &&
    isNonblankString(stop.kind) &&
    isFiniteNumber(stop.cumulative_miles) &&
    isCoordinate(stop.coordinate) &&
    isNonblankString(stop.start) &&
    isNonblankString(stop.end) &&
    isDutyStatus(stop.status) &&
    typeof stop.note === "string"
  )
}

function isValidLogDay(day) {
  return (
    isObject(day) &&
    isNonblankString(day.date) &&
    isFiniteNumber(day.total_miles) &&
    isObject(day.status_totals_minutes) &&
    DUTY_STATUSES.every((status) =>
      isFiniteNumber(day.status_totals_minutes[status]),
    ) &&
    Array.isArray(day.segments) &&
    day.segments.length > 0 &&
    day.segments.every(isValidSegment)
  )
}

function isValidSummary(summary) {
  return (
    isObject(summary) &&
    [
      summary.total_distance_miles,
      summary.total_duration_minutes,
      summary.leg_count,
      summary.stop_count,
      summary.duty_segment_count,
      summary.log_day_count,
    ].every(isFiniteNumber)
  )
}

async function readJson(response, category) {
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new TripApiError(category)
  }

  if (!response?.ok) {
    throw new TripApiError(category, payload, response.status)
  }
  return payload
}

function categorize(error, category) {
  if (error?.name === "AbortError" || error instanceof TripApiError) {
    throw error
  }
  throw new TripApiError(category)
}

export async function createTrip(baseUrl, input, signal) {
  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/trips/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal,
    })
    const payload = await readJson(response, "create")

    const tripId = payload?.trip?.id
    if (!UUID_PATTERN.test(tripId) || !isCompleteSnapshot(payload, tripId)) {
      throw new TripApiError("create")
    }

    return payload
  } catch (error) {
    categorize(error, "create")
  }
}

export async function getTrip(baseUrl, id, signal) {
  try {
    if (!UUID_PATTERN.test(id)) {
      throw new TripApiError("retrieve")
    }

    const response = await fetch(
      `${normalizeBaseUrl(baseUrl)}/api/trips/${id}/`,
      { signal },
    )
    const snapshot = await readJson(response, "retrieve")

    if (!isCompleteSnapshot(snapshot, id)) {
      throw new TripApiError("retrieve")
    }

    return snapshot
  } catch (error) {
    categorize(error, "retrieve")
  }
}

export async function searchLocations(baseUrl, query, signal) {
  try {
    const normalizedQuery = query.trim()
    if (normalizedQuery.length < 3 || normalizedQuery.length > 200) {
      throw new TripApiError("search")
    }

    const params = new URLSearchParams({ q: normalizedQuery })
    const response = await fetch(
      `${normalizeBaseUrl(baseUrl)}/api/locations/?${params}`,
      { signal },
    )
    const payload = await readJson(response, "search")

    if (
      !isObject(payload) ||
      !Array.isArray(payload.results) ||
      payload.results.length > 5 ||
      !payload.results.every(
        (result) =>
          isObject(result) &&
          isNonblankString(result.label) &&
          isCoordinate(result.coordinate),
      )
    ) {
      throw new TripApiError("search")
    }

    return payload.results
  } catch (error) {
    categorize(error, "search")
  }
}

function isCompleteSnapshot(snapshot, expectedId) {
  if (
    !isObject(snapshot) ||
    snapshot.schema_version !== 1 ||
    !isObject(snapshot.trip) ||
    snapshot.trip.id !== expectedId ||
    !isNonblankString(snapshot.trip.departure_local) ||
    snapshot.trip.departure_assumed !== true ||
    !isFiniteNumber(snapshot.trip.cycle_hours_used) ||
    !isObject(snapshot.locations) ||
    !LOCATION_ROLES.every((role) => isValidLocation(snapshot.locations[role])) ||
    !isObject(snapshot.route) ||
    snapshot.route.profile !== "driving-hgv" ||
    !isFiniteNumber(snapshot.route.total_distance_miles) ||
    !isFiniteNumber(snapshot.route.total_duration_minutes) ||
    !Array.isArray(snapshot.route.legs) ||
    !snapshot.route.legs.every(isValidLeg) ||
    !isObject(snapshot.route.geometry) ||
    snapshot.route.geometry.type !== "LineString" ||
    !Array.isArray(snapshot.route.geometry.coordinates) ||
    snapshot.route.geometry.coordinates.length < 2 ||
    !snapshot.route.geometry.coordinates.every(isCoordinate) ||
    !Array.isArray(snapshot.stops) ||
    !snapshot.stops.every(isValidStop) ||
    !Array.isArray(snapshot.duty_segments) ||
    snapshot.duty_segments.length === 0 ||
    !snapshot.duty_segments.every(isValidSegment) ||
    !Array.isArray(snapshot.log_days) ||
    snapshot.log_days.length === 0 ||
    !snapshot.log_days.every(isValidLogDay) ||
    !isValidSummary(snapshot.summary)
  ) {
    return false
  }
  return true
}
