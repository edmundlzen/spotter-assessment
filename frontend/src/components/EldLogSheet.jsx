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
const ROW_LABELS = {
  off_duty: ["1. Off Duty"],
  sleeper_berth: ["2. Sleeper", "Berth"],
  driving: ["3. Driving"],
  on_duty_not_driving: ["4. On Duty", "(not driving)"],
}
const TRACE_Y = {
  off_duty: 10,
  sleeper_berth: 30,
  driving: 50,
  on_duty_not_driving: 70,
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
  const stops = stopsForDate(snapshot.stops, day.date)
  const stopEventKeys = new Set(
    stops.map((stop) => `${stop.start}|${stop.status}`),
  )
  const stopRemarks = stops.map((stop, index) => ({
    key: `stop-${stop.start}-${stop.kind}-${index}`,
    start: stop.start,
    text: `${stop.start.slice(11, 16)} ${stopLabel(stop.kind)} — mile ${formatMiles(stop.cumulative_miles, 0)}`,
  }))
  const segmentRemarks = day.segments
    .filter((segment) => segment.note && segment.note !== "outside trip")
    .filter(
      (segment) =>
        !stopEventKeys.has(`${segment.start}|${segment.status}`),
    )
    .map((segment, index) => ({
      key: `segment-${segment.start}-${segment.end}-${segment.status}-${index}`,
      start: segment.start,
      text: `${segment.start.slice(11, 16)} ${segment.note}`,
    }))

  return [...stopRemarks, ...segmentRemarks].sort((left, right) =>
    left.start.localeCompare(right.start),
  )
}

function DutyTrace({ day }) {
  return (
    <svg
      aria-hidden="true"
      className="paper-log__trace"
      preserveAspectRatio="none"
      viewBox="0 0 1440 80"
    >
      {day.segments.map((segment, index) => {
        const start = minuteOfLogDay(segment.start, day.date)
        const end = minuteOfLogDay(segment.end, day.date)
        const previous = day.segments[index - 1]
        const y = TRACE_Y[segment.status]

        return (
          <g key={`${segment.start}-${segment.status}-${index}`}>
            {previous && (
              <line
                className="paper-log__transition"
                x1={start}
                x2={start}
                y1={TRACE_Y[previous.status]}
                y2={y}
              />
            )}
            <line
              className="paper-log__status-line"
              x1={start}
              x2={end}
              y1={y}
              y2={y}
            />
          </g>
        )
      })}
    </svg>
  )
}

function LineField({ children, label }) {
  return (
    <div className="paper-log__line-field">
      <span>{children}</span>
      <small>{label}</small>
    </div>
  )
}

function BlankLine({ label }) {
  return (
    <div className="paper-log__blank-line">
      <span aria-hidden="true">&nbsp;</span>
      <small>{label}</small>
    </div>
  )
}

function PaperLogForm({ day, snapshot }) {
  const parts = dateParts(day.date)
  const remarks = remarksForDay(day, snapshot)

  return (
    <section
      aria-label={`Filled driver's daily log for ${formatDate(day.date)}`}
      className="paper-log"
      data-testid="eld-log-form"
    >
      <header className="paper-log__masthead">
        <div>
          <h4>Drivers Daily Log</h4>
          <p>[24 hours]</p>
        </div>
        <div className="paper-log__date" aria-label="Log date">
          <LineField label="(month)">{parts.month}</LineField>
          <span>/</span>
          <LineField label="(day)">{parts.day}</LineField>
          <span>/</span>
          <LineField label="(year)">{parts.year}</LineField>
        </div>
        <div className="paper-log__copy">
          <strong>Original</strong> - File at home terminal.
          <br />
          <strong>Duplicate</strong> - Driver retains in possession for 8 days.
        </div>
      </header>

      <div className="paper-log__route">
        <LineField label="From:">
          {shorten(snapshot.locations.current.label, 48)}
        </LineField>
        <LineField label="To:">
          {shorten(snapshot.locations.dropoff.label, 48)}
        </LineField>
      </div>

      <div className="paper-log__details">
        <div className="paper-log__vehicle">
          <div className="paper-log__mileage">
            <LineField label="Total Miles Driving Today">
              {formatMiles(day.total_miles, 0)}
            </LineField>
            <LineField label="Total Mileage Today">
              {formatMiles(day.total_miles, 0)}
            </LineField>
          </div>
          <BlankLine label="Truck/Tractor and Trailer Numbers or License Plate(s)/State" />
        </div>
        <div className="paper-log__carrier">
          <BlankLine label="Name of Carrier or Carriers" />
          <BlankLine label="Main Office Address" />
          <BlankLine label="Home Terminal Address" />
        </div>
      </div>

      <div className="paper-log__grid" aria-label="24-hour duty status grid">
        <div className="paper-log__grid-corner">Mid-<br />night</div>
        <div className="paper-log__hours">
          {Array.from({ length: 24 }, (_, index) => {
            const hour = index + 1
            return (
              <span key={hour}>
                {hour === 12 ? "Noon" : hour === 24 ? "Midnight" : hour > 12 ? hour - 12 : hour}
              </span>
            )
          })}
        </div>
        <div className="paper-log__total-heading">Total<br />Hours</div>

        <div className="paper-log__row-labels">
          {ROWS.map((status) => (
            <div key={status}>
              {ROW_LABELS[status].map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
          ))}
        </div>
        <div className="paper-log__timeline">
          {Array.from({ length: 97 }, (_, index) => (
            <i
              className={
                index % 4 === 0
                  ? "paper-log__tick paper-log__tick--hour"
                  : index % 2 === 0
                    ? "paper-log__tick paper-log__tick--half"
                    : "paper-log__tick paper-log__tick--quarter"
              }
              key={index}
              style={{ left: `${(index / 96) * 100}%` }}
            />
          ))}
          <DutyTrace day={day} />
        </div>
        <div className="paper-log__totals">
          {ROWS.map((status) => (
            <span key={status}>
              {formatLogTotal(day.status_totals_minutes[status])}
            </span>
          ))}
        </div>
      </div>

      <section className="paper-log__remarks">
        <h5>Remarks</h5>
        <div className="paper-log__remark-lines">
          {remarks.length ? (
            remarks.map((remark) => <p key={remark.key}>{remark.text}</p>)
          ) : (
            <p>No scheduled stops or additional remarks.</p>
          )}
        </div>
        <div className="paper-log__shipping">
          <div>
            <strong>Shipping Documents:</strong>
            <BlankLine label="DVL or Manifest No. or" />
            <BlankLine label="Shipper & Commodity" />
          </div>
          <p>
            Enter the place where you reported and were released from work,
            and where each change of duty occurred. Use home terminal time.
          </p>
        </div>
      </section>

      <section className="paper-log__recap">
        <div>
          <h5>Recap:</h5>
          <p>Complete at<br />end of day</p>
        </div>
        <div><strong>70 Hour/<br />8 Day<br />Drivers</strong></div>
        <div><strong>On duty<br />hours today</strong></div>
        <div><strong>A.</strong> Total hours on duty last 7 days including today.</div>
        <div><strong>B.</strong> Total hours available tomorrow. 70 hr. minus A.</div>
        <div><strong>C.</strong> Total hours on duty last 8 days including today.</div>
      </section>
    </section>
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
          <PaperLogForm day={day} snapshot={snapshot} />
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
