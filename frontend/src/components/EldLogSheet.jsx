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
  STATUS_META,
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
const GRID_X = 138
const GRID_Y = 76
const GRID_WIDTH = 720
const ROW_HEIGHT = 43
const GRID_HEIGHT = ROW_HEIGHT * ROWS.length

function xForMinute(minute) {
  return GRID_X + (minute / 1_440) * GRID_WIDTH
}

function yForStatus(status) {
  return GRID_Y + ROWS.indexOf(status) * ROW_HEIGHT + ROW_HEIGHT / 2
}

function formatLogTotal(minutes) {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}:${String(mins).padStart(2, "0")}`
}

function LogGrid({ day }) {
  const total = ROWS.reduce(
    (sum, status) => sum + day.status_totals_minutes[status],
    0,
  )

  return (
    <svg
      aria-label={`Driver log grid for ${formatDate(day.date)}`}
      className="eld-grid"
      role="img"
      viewBox="0 0 980 282"
    >
      <rect
        className="eld-grid__outline"
        height={GRID_HEIGHT}
        width={GRID_WIDTH}
        x={GRID_X}
        y={GRID_Y}
      />

      {ROWS.map((status, index) => {
        const y = GRID_Y + index * ROW_HEIGHT
        return (
          <g key={status}>
            <text className="eld-grid__row-label" x="126" y={y + 26}>
              {STATUS_META[status].shortLabel}
            </text>
            {index > 0 && (
              <line
                className="eld-grid__row-line"
                x1={GRID_X}
                x2={GRID_X + GRID_WIDTH}
                y1={y}
                y2={y}
              />
            )}
            <text
              className="eld-grid__total"
              x="886"
              y={y + 26}
            >
              {formatLogTotal(day.status_totals_minutes[status])}
            </text>
          </g>
        )
      })}

      {Array.from({ length: 97 }, (_, index) => {
        const x = GRID_X + (index / 96) * GRID_WIDTH
        const isHour = index % 4 === 0
        const isHalfHour = index % 2 === 0
        return (
          <line
            className={
              isHour
                ? "eld-grid__tick eld-grid__tick--hour"
                : isHalfHour
                  ? "eld-grid__tick eld-grid__tick--half"
                  : "eld-grid__tick eld-grid__tick--quarter"
            }
            key={index}
            x1={x}
            x2={x}
            y1={isHour ? GRID_Y : GRID_Y + 7}
            y2={GRID_Y + GRID_HEIGHT}
          />
        )
      })}

      {Array.from({ length: 25 }, (_, hour) => (
        <text
          className="eld-grid__hour"
          key={hour}
          textAnchor={
            hour === 0 ? "start" : hour === 24 ? "end" : "middle"
          }
          x={xForMinute(hour * 60)}
          y="65"
        >
          {hour === 0
            ? "Midnight"
            : hour === 12
              ? "Noon"
              : hour === 24
                ? "Midnight"
                : hour > 12
                  ? hour - 12
                  : hour}
        </text>
      ))}

      {day.segments.map((segment, index) => {
        const start = minuteOfLogDay(segment.start, day.date)
        const end = minuteOfLogDay(segment.end, day.date)
        const y = yForStatus(segment.status)
        const previous = day.segments[index - 1]
        return (
          <g key={`${segment.start}-${segment.status}-${index}`}>
            {previous && (
              <line
                className="eld-grid__transition"
                x1={xForMinute(start)}
                x2={xForMinute(start)}
                y1={yForStatus(previous.status)}
                y2={y}
              />
            )}
            <line
              className="eld-grid__status-line"
              style={{ stroke: STATUS_META[segment.status].color }}
              x1={xForMinute(start)}
              x2={xForMinute(end)}
              y1={y}
              y2={y}
            />
          </g>
        )
      })}

      <text className="eld-grid__totals-heading" x="886" y="65">
        Hours
      </text>
      <text
        className={total === 1_440 ? "eld-grid__day-total" : "eld-grid__day-total eld-grid__day-total--error"}
        x="886"
        y={GRID_Y + GRID_HEIGHT + 26}
      >
        Total {formatLogTotal(total)}
      </text>
    </svg>
  )
}

function LogSheet({ day, snapshot }) {
  const events = stopsForDate(snapshot.stops, day.date)
  const remarks = [
    ...events.map(
      (stop) =>
        `${stop.start.slice(11, 16)} ${stopLabel(stop.kind)} at ${formatMiles(stop.cumulative_miles, 0)} mi`,
    ),
    ...day.segments
      .filter((segment) => segment.note && segment.note !== "outside trip")
      .map((segment) => segment.note),
  ]
  const uniqueRemarks = [...new Set(remarks)]

  return (
    <Box className="eld-sheet" component="article">
      <div className="eld-sheet__masthead">
        <div>
          <p className="eld-sheet__form-label">DRIVER’S DAILY LOG</p>
          <h3>{formatDate(day.date)}</h3>
        </div>
        <div className="eld-sheet__summary">
          <span>
            <small>Total miles</small>
            <strong>{formatMiles(day.total_miles, 0)}</strong>
          </span>
          <span>
            <small>Record type</small>
            <strong>Planned duty log</strong>
          </span>
        </div>
      </div>

      <div className="eld-sheet__route">
        <span>
          <small>From</small>
          {snapshot.locations.current.label}
        </span>
        <span>
          <small>Via</small>
          {snapshot.locations.pickup.label}
        </span>
        <span>
          <small>To</small>
          {snapshot.locations.dropoff.label}
        </span>
      </div>

      <div className="eld-grid-scroll">
        <LogGrid day={day} />
      </div>

      <div className="eld-sheet__legend">
        {ROWS.map((status) => (
          <span key={status}>
            <i style={{ background: STATUS_META[status].color }} />
            {STATUS_META[status].label}
          </span>
        ))}
      </div>

      <div className="eld-sheet__remarks">
        <strong>Remarks</strong>
        <p>
          {uniqueRemarks.length
            ? uniqueRemarks.join(" · ")
            : "No scheduled stops or additional remarks."}
        </p>
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
            One 24-hour duty record per calendar day.
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
            aria-labelledby={`log-tab-${index}`}
            aria-hidden={activeDay !== index}
            className={
              activeDay === index
                ? "eld-day-panel eld-day-panel--active"
                : "eld-day-panel"
            }
            key={day.date}
            role="tabpanel"
          >
            <LogSheet day={day} snapshot={snapshot} />
          </div>
        ))}
      </div>
    </Paper>
  )
}
