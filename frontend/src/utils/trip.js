export const STATUS_META = {
  off_duty: {
    label: "Off duty",
    shortLabel: "OFF",
    color: "#616161",
    soft: "#eef0f1",
  },
  sleeper_berth: {
    label: "Sleeper berth",
    shortLabel: "SB",
    color: "#7c4dff",
    soft: "#eee8ff",
  },
  driving: {
    label: "Driving",
    shortLabel: "D",
    color: "#1976d2",
    soft: "#e8f0fe",
  },
  on_duty_not_driving: {
    label: "On duty (not driving)",
    shortLabel: "ON",
    color: "#ed6c02",
    soft: "#fff1df",
  },
}

export const STOP_META = {
  pickup: { label: "Pickup", tone: "pickup" },
  dropoff: { label: "Drop-off", tone: "dropoff" },
  fuel: { label: "Fuel stop", tone: "fuel" },
  break: { label: "30-minute break", tone: "break" },
  reset: { label: "10-hour reset", tone: "rest" },
  restart: { label: "34-hour restart", tone: "rest" },
}

const ON_DUTY_STATUSES = new Set(["driving", "on_duty_not_driving"])

export function formatMiles(value, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value)
}

export function formatDuration(minutes, { compact = false } = {}) {
  const rounded = Math.max(0, Math.round(minutes))
  const days = Math.floor(rounded / 1_440)
  const hours = Math.floor((rounded % 1_440) / 60)
  const mins = rounded % 60
  const parts = []
  if (days) parts.push(`${days}${compact ? "d" : days === 1 ? " day" : " days"}`)
  if (hours) parts.push(`${hours}${compact ? "h" : hours === 1 ? " hr" : " hrs"}`)
  if (mins || parts.length === 0) {
    parts.push(`${mins}${compact ? "m" : " min"}`)
  }
  return parts.join(compact ? " " : " ")
}

export function formatHours(minutes, digits = 1) {
  return `${(minutes / 60).toFixed(digits)} h`
}

export function formatClock(timestamp) {
  const date = new Date(`${timestamp}Z`)
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date)
}

export function formatDate(dateValue, options = {}) {
  const date = new Date(
    dateValue.length === 10 ? `${dateValue}T00:00:00Z` : `${dateValue}Z`,
  )
  return new Intl.DateTimeFormat("en-US", {
    month: options.short ? "short" : "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)
}

export function minuteOfLogDay(timestamp, logDate) {
  const start = Date.parse(`${logDate}T00:00:00Z`)
  const value = Date.parse(`${timestamp}Z`)
  return Math.min(1_440, Math.max(0, Math.round((value - start) / 60_000)))
}

export function routePositions(snapshot) {
  return snapshot.route.geometry.coordinates.map(([longitude, latitude]) => [
    latitude,
    longitude,
  ])
}

export function stopLabel(kind) {
  return STOP_META[kind]?.label ?? kind.replaceAll("_", " ")
}

export function calculateHosBalances(snapshot) {
  const segments = snapshot.duty_segments
  const tripEnd = Date.parse(`${segments.at(-1).end}Z`)

  const lastShiftReset = [...segments]
    .reverse()
    .find(
      (segment) =>
        segment.status === "off_duty" &&
        segment.duration_minutes >= 600 &&
        Date.parse(`${segment.end}Z`) <= tripEnd,
    )
  const shiftStart = lastShiftReset
    ? Date.parse(`${lastShiftReset.end}Z`)
    : Date.parse(`${snapshot.trip.departure_local}Z`)
  const shiftSegments = segments.filter(
    (segment) => Date.parse(`${segment.end}Z`) > shiftStart,
  )
  const shiftDriving = shiftSegments
    .filter((segment) => segment.status === "driving")
    .reduce((total, segment) => total + segment.duration_minutes, 0)
  const firstShiftDuty = shiftSegments.find((segment) =>
    ON_DUTY_STATUSES.has(segment.status),
  )
  const windowUsed = firstShiftDuty
    ? Math.max(
        0,
        Math.round(
          (tripEnd - Date.parse(`${firstShiftDuty.start}Z`)) / 60_000,
        ),
      )
    : 0

  const lastCycleRestart = [...segments]
    .reverse()
    .find(
      (segment) =>
        segment.status === "off_duty" &&
        segment.duration_minutes >= 2_040 &&
        Date.parse(`${segment.end}Z`) <= tripEnd,
    )
  const cycleStart = lastCycleRestart
    ? Date.parse(`${lastCycleRestart.end}Z`)
    : Number.NEGATIVE_INFINITY
  const priorCycleMinutes = lastCycleRestart
    ? 0
    : Math.round(snapshot.trip.cycle_hours_used * 60)
  const plannedCycleMinutes = segments
    .filter(
      (segment) =>
        ON_DUTY_STATUSES.has(segment.status) &&
        Date.parse(`${segment.end}Z`) > cycleStart,
    )
    .reduce((total, segment) => total + segment.duration_minutes, 0)

  const totalDrivingMinutes = segments
    .filter((segment) => segment.status === "driving")
    .reduce((total, segment) => total + segment.duration_minutes, 0)
  const totalOnDutyMinutes = segments
    .filter((segment) => ON_DUTY_STATUSES.has(segment.status))
    .reduce((total, segment) => total + segment.duration_minutes, 0)

  return {
    driving: {
      label: "Drive time left",
      remaining: Math.max(0, 660 - shiftDriving),
      limit: 660,
      used: shiftDriving,
    },
    window: {
      label: "14-hour window left",
      remaining: Math.max(0, 840 - windowUsed),
      limit: 840,
      used: Math.min(840, windowUsed),
    },
    cycle: {
      label: "70-hour cycle left",
      remaining: Math.max(
        0,
        4_200 - priorCycleMinutes - plannedCycleMinutes,
      ),
      limit: 4_200,
      used: Math.min(4_200, priorCycleMinutes + plannedCycleMinutes),
    },
    totalDrivingMinutes,
    totalOnDutyMinutes,
  }
}

export function stopsForDate(stops, date) {
  return stops.filter((stop) => stop.start.slice(0, 10) === date)
}
