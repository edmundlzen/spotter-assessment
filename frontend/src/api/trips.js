export const FIXED_TRIP = Object.freeze({
  current_location: "New York, NY",
  pickup_location: "Chicago, IL",
  dropoff_location: "Dallas, TX",
  cycle_hours_used: 0,
})

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const SUMMARY_FIELDS = [
  "total_distance_miles",
  "total_duration_minutes",
  "leg_count",
  "stop_count",
  "duty_segment_count",
  "log_day_count",
]

const DUTY_STATUSES = [
  "off_duty",
  "sleeper_berth",
  "driving",
  "on_duty_not_driving",
]

const LOCATION_ROLES = ["current", "pickup", "dropoff"]
const LEG_ENDPOINTS = [
  ["current", "pickup"],
  ["pickup", "dropoff"],
]

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

function isNonnegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0
}

function isPositiveCount(value) {
  return Number.isInteger(value) && value > 0
}

function isNonblankString(value) {
  return typeof value === "string" && value.trim().length > 0
}

function isLocalTimestamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)
  ) {
    return false
  }

  const parsed = new Date(`${value}Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }

  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
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

function isValidTimeRange(start, end) {
  return (
    isLocalTimestamp(start) &&
    isLocalTimestamp(end) &&
    new Date(`${end}Z`) > new Date(`${start}Z`)
  )
}

function isValidSegment(segment) {
  if (
    !isObject(segment) ||
    !isDutyStatus(segment.status) ||
    !isValidTimeRange(segment.start, segment.end) ||
    !isPositiveCount(segment.duration_minutes) ||
    typeof segment.note !== "string"
  ) {
    return false
  }

  const elapsedMinutes =
    (new Date(`${segment.end}Z`) - new Date(`${segment.start}Z`)) / 60_000
  return elapsedMinutes === segment.duration_minutes
}

function isValidLocation(location) {
  return (
    isObject(location) &&
    isNonblankString(location.query) &&
    isNonblankString(location.label) &&
    isCoordinate(location.coordinate)
  )
}

function isValidLeg(leg, endpoints) {
  return (
    isObject(leg) &&
    leg.from === endpoints[0] &&
    leg.to === endpoints[1] &&
    isNonnegativeNumber(leg.distance_miles) &&
    isPositiveCount(leg.duration_minutes)
  )
}

function isValidStop(stop) {
  return (
    isObject(stop) &&
    isNonblankString(stop.kind) &&
    isNonnegativeNumber(stop.cumulative_miles) &&
    isCoordinate(stop.coordinate) &&
    isValidTimeRange(stop.start, stop.end) &&
    isDutyStatus(stop.status) &&
    typeof stop.note === "string"
  )
}

function isValidLogDay(day) {
  if (
    !isObject(day) ||
    !isIsoDate(day.date) ||
    !isNonnegativeNumber(day.total_miles) ||
    !isObject(day.status_totals_minutes) ||
    Object.keys(day.status_totals_minutes).length !== DUTY_STATUSES.length ||
    !DUTY_STATUSES.every(
      (status) =>
        Object.hasOwn(day.status_totals_minutes, status) &&
        isCount(day.status_totals_minutes[status]),
    ) ||
    !Array.isArray(day.segments) ||
    day.segments.length === 0 ||
    !day.segments.every(isValidSegment)
  ) {
    return false
  }

  if (
    DUTY_STATUSES.reduce(
      (total, status) => total + day.status_totals_minutes[status],
      0,
    ) !== 1_440
  ) {
    return false
  }

  const segmentTotals = Object.fromEntries(
    DUTY_STATUSES.map((status) => [status, 0]),
  )
  for (const segment of day.segments) {
    segmentTotals[segment.status] += segment.duration_minutes
  }
  return DUTY_STATUSES.every(
    (status) => segmentTotals[status] === day.status_totals_minutes[status],
  )
}

function isValidSummary(summary) {
  return (
    isObject(summary) &&
    SUMMARY_FIELDS.every((field) => Object.hasOwn(summary, field)) &&
    isNonnegativeNumber(summary.total_distance_miles) &&
    isCount(summary.total_duration_minutes) &&
    SUMMARY_FIELDS.slice(2).every((field) => isCount(summary[field]))
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

    if (
      !isObject(payload) ||
      !UUID_PATTERN.test(payload.id) ||
      !isValidSummary(payload.summary)
    ) {
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

function isCompleteSnapshot(snapshot, expectedId) {
  if (
    !isObject(snapshot) ||
    snapshot.schema_version !== 1 ||
    !isObject(snapshot.trip) ||
    snapshot.trip.id !== expectedId ||
    !isLocalTimestamp(snapshot.trip.departure_local) ||
    snapshot.trip.departure_assumed !== true ||
    !isNonnegativeNumber(snapshot.trip.cycle_hours_used) ||
    snapshot.trip.cycle_hours_used > 70 ||
    !isObject(snapshot.locations) ||
    !LOCATION_ROLES.every((role) => isValidLocation(snapshot.locations[role])) ||
    !isObject(snapshot.route) ||
    snapshot.route.profile !== "driving-hgv" ||
    !isNonnegativeNumber(snapshot.route.total_distance_miles) ||
    !isPositiveCount(snapshot.route.total_duration_minutes) ||
    !Array.isArray(snapshot.route.legs) ||
    snapshot.route.legs.length !== LEG_ENDPOINTS.length ||
    !snapshot.route.legs.every((leg, index) =>
      isValidLeg(leg, LEG_ENDPOINTS[index]),
    ) ||
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

  const { route, stops, duty_segments: segments, log_days: days, summary } =
    snapshot

  return (
    stops.every(
      (stop, index) =>
        stop.cumulative_miles <= route.total_distance_miles &&
        (index === 0 ||
          stop.cumulative_miles >= stops[index - 1].cumulative_miles),
    ) &&
    summary.total_distance_miles === route.total_distance_miles &&
    summary.total_duration_minutes === route.total_duration_minutes &&
    summary.leg_count === route.legs.length &&
    summary.stop_count === stops.length &&
    summary.duty_segment_count === segments.length &&
    summary.log_day_count === days.length
  )
}
