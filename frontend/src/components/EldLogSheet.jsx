import { useState } from "react"
import PrintOutlined from "@mui/icons-material/PrintOutlined"
import {
  Box,
  Button,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material"

import {
  formatDate,
  formatMiles,
  minuteOfLogDay,
  stopLabel,
  stopsForDate,
} from "../utils/trip.js"

const ROWS = [
  "off_duty",
  "sleeper_berth",
  "driving",
  "on_duty_not_driving",
]
const PAPER_WIDTH = 513
const PAPER_HEIGHT = 518
const GRID_X = 65
const GRID_WIDTH = 388
const ROW_Y = {
  off_duty: 181,
  sleeper_berth: 199,
  driving: 217,
  on_duty_not_driving: 235,
}

function xForMinute(minute) {
  return GRID_X + (Math.max(0, Math.min(1_440, minute)) / 1_440) * GRID_WIDTH
}

function formatLogTotal(minutes) {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}:${String(mins).padStart(2, "0")}`
}

function shorten(value, length) {
  if (!value || value.length <= length) return value
  return `${value.slice(0, length - 1).trimEnd()}…`
}

function dateParts(date) {
  const [year, month, day] = date.split("-")
  return { day, month, year: year.slice(-2) }
}

function remarksForDay(day, snapshot) {
  const stopRemarks = stopsForDate(snapshot.stops, day.date).map(
    (stop) =>
      `${stop.start.slice(11, 16)} ${stopLabel(stop.kind)} — mile ${formatMiles(stop.cumulative_miles, 0)}`,
  )
  const segmentRemarks = day.segments
    .filter((segment) => segment.note && segment.note !== "outside trip")
    .map(
      (segment) =>
        `${segment.start.slice(11, 16)} ${segment.note}`,
    )

  return [...new Set([...stopRemarks, ...segmentRemarks])]
    .slice(0, 3)
    .map((remark) => shorten(remark, 70))
}

function PaperLogOverlay({ day, snapshot }) {
  const parts = dateParts(day.date)
  const remarks = remarksForDay(day, snapshot)

  return (
    <svg
      aria-label={`Filled driver's daily log for ${formatDate(day.date)}`}
      className="eld-paper__overlay"
      data-testid="eld-log-overlay"
      role="img"
      viewBox={`0 0 ${PAPER_WIDTH} ${PAPER_HEIGHT}`}
    >
      <title>{`Filled driver's daily log for ${formatDate(day.date)}`}</title>

      <g className="eld-paper__writing">
        <text textAnchor="middle" x="194" y="27">{parts.month}</text>
        <text textAnchor="middle" x="235" y="27">{parts.day}</text>
        <text textAnchor="middle" x="273" y="27">{parts.year}</text>

        <text x="64" y="45">
          {shorten(snapshot.locations.current.label, 38)}
        </text>
        <text x="262" y="45">
          {shorten(snapshot.locations.dropoff.label, 34)}
        </text>

        <text textAnchor="middle" x="94" y="80">
          {formatMiles(day.total_miles, 0)}
        </text>
        <text textAnchor="middle" x="180" y="80">
          {formatMiles(day.total_miles, 0)}
        </text>

        {ROWS.map((status) => (
          <text
            className="eld-paper__total"
            key={status}
            textAnchor="middle"
            x="479"
            y={ROW_Y[status] + 3}
          >
            {formatLogTotal(day.status_totals_minutes[status])}
          </text>
        ))}

        {remarks.map((remark, index) => (
          <text key={remark} x="78" y={278 + index * 12}>
            {remark}
          </text>
        ))}
      </g>

      <g className="eld-paper__duty-lines">
        {day.segments.map((segment, index) => {
          const start = minuteOfLogDay(segment.start, day.date)
          const end = minuteOfLogDay(segment.end, day.date)
          const previous = day.segments[index - 1]
          const y = ROW_Y[segment.status]

          return (
            <g key={`${segment.start}-${segment.status}-${index}`}>
              {previous && (
                <line
                  className="eld-paper__transition"
                  x1={xForMinute(start)}
                  x2={xForMinute(start)}
                  y1={ROW_Y[previous.status]}
                  y2={y}
                />
              )}
              <line
                className="eld-paper__status-line"
                x1={xForMinute(start)}
                x2={xForMinute(end)}
                y1={y}
                y2={y}
              />
            </g>
          )
        })}
      </g>
    </svg>
  )
}

function LogSheet({ day, index, snapshot }) {
  return (
    <Box className="eld-sheet" component="article">
      <div className="eld-sheet__caption">
        <div>
          <Typography component="h3" variant="subtitle1">
            Day {index + 1} · {formatDate(day.date)}
          </Typography>
          <Typography color="text.secondary" variant="caption">
            {formatMiles(day.total_miles, 0)} driving miles · completed 24-hour form
          </Typography>
        </div>
      </div>

      <div className="eld-paper-scroll">
        <div className="eld-paper" data-testid="eld-paper-log">
          <img
            alt=""
            aria-hidden="true"
            className="eld-paper__form"
            src="/blank-paper-log.png"
          />
          <PaperLogOverlay day={day} snapshot={snapshot} />
        </div>
      </div>
    </Box>
  )
}

export default function EldLogSheets({ snapshot }) {
  const [activeDay, setActiveDay] = useState(0)

  return (
    <Paper
      aria-labelledby="logs-title"
      className="logs-card"
      component="section"
      elevation={1}
      sx={{ p: { xs: 2, sm: 2.5 } }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{
          alignItems: { xs: "flex-start", sm: "center" },
          justifyContent: "space-between",
          mb: 2,
        }}
      >
        <Box>
          <Typography component="h2" id="logs-title" variant="h6">
            Daily driver logs
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Filled paper log sheets · one form per calendar day.
          </Typography>
        </Box>
        <Button
          className="print-button"
          onClick={() => window.print()}
          startIcon={<PrintOutlined />}
          variant="outlined"
        >
          Print all logs
        </Button>
      </Stack>

      <Tabs
        allowScrollButtonsMobile
        aria-label="Daily logs"
        onChange={(_, value) => setActiveDay(value)}
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}
        value={activeDay}
        variant="scrollable"
      >
        {snapshot.log_days.map((day, index) => (
          <Tab
            id={`log-tab-${index}`}
            key={day.date}
            label={`Day ${index + 1} · ${formatDate(day.date, { short: true })}`}
          />
        ))}
      </Tabs>

      <div className="eld-days">
        {snapshot.log_days.map((day, index) => (
          <div
            aria-hidden={activeDay !== index}
            aria-labelledby={`log-tab-${index}`}
            className={
              activeDay === index
                ? "eld-day-panel eld-day-panel--active"
                : "eld-day-panel"
            }
            key={day.date}
            role="tabpanel"
          >
            <LogSheet day={day} index={index} snapshot={snapshot} />
          </div>
        ))}
      </div>
    </Paper>
  )
}
