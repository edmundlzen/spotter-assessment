import AddRoadOutlined from "@mui/icons-material/AddRoadOutlined"
import CalendarMonthOutlined from "@mui/icons-material/CalendarMonthOutlined"
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded"
import ContentCopyOutlined from "@mui/icons-material/ContentCopyOutlined"
import ScheduleOutlined from "@mui/icons-material/ScheduleOutlined"
import StraightenOutlined from "@mui/icons-material/StraightenOutlined"
import WorkHistoryOutlined from "@mui/icons-material/WorkHistoryOutlined"
import {
  Alert,
  Avatar,
  Box,
  Button,
  Container,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material"

import EldLogSheets from "./EldLogSheet.jsx"
import TripMap from "./TripMap.jsx"
import {
  STATUS_META,
  calculateHosBalances,
  formatClock,
  formatDate,
  formatDuration,
  formatDurationAsHours,
  formatMiles,
  stopLabel,
} from "../utils/trip.js"

function SummaryCards({ snapshot, balances }) {
  const start = Date.parse(`${snapshot.duty_segments[0].start}Z`)
  const end = Date.parse(`${snapshot.duty_segments.at(-1).end}Z`)
  const tripElapsed = Math.round((end - start) / 60_000)
  const items = [
    {
      label: "Route distance",
      value: `${formatMiles(snapshot.summary.total_distance_miles, 0)} mi`,
      detail: `${snapshot.summary.leg_count} route legs`,
      icon: StraightenOutlined,
    },
    {
      label: "Estimated drive time",
      value: formatDuration(snapshot.summary.total_duration_minutes),
      detail: "Road estimate",
      icon: ScheduleOutlined,
    },
    {
      label: "Trip duration",
      value: formatDuration(tripElapsed),
      detail: `${snapshot.summary.log_day_count} daily logs`,
      icon: CalendarMonthOutlined,
    },
    {
      label: "On-duty time",
      value: formatDuration(balances.totalOnDutyMinutes),
      detail: `${formatDuration(balances.totalDrivingMinutes)} driving`,
      icon: WorkHistoryOutlined,
    },
  ]

  return (
    <Box
      aria-label="Trip summary"
      className="summary-cards"
      sx={{
        display: "grid",
        gap: 2,
        gridTemplateColumns: {
          xs: "1fr",
          sm: "repeat(2, minmax(0, 1fr))",
          lg: "repeat(4, minmax(0, 1fr))",
        },
      }}
    >
      {items.map((item) => {
        const Icon = item.icon
        return (
          <Paper component="article" elevation={1} key={item.label} sx={{ p: 2 }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <Avatar
                sx={{
                  bgcolor: "primary.main",
                  height: 38,
                  width: 38,
                }}
                variant="rounded"
              >
                <Icon fontSize="small" />
              </Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Typography color="text.secondary" variant="caption">
                  {item.label}
                </Typography>
                <Typography component="p" fontWeight={700} noWrap variant="h6">
                  {item.value}
                </Typography>
                <Typography color="text.secondary" variant="caption">
                  {item.detail}
                </Typography>
              </Box>
            </Stack>
          </Paper>
        )
      })}
    </Box>
  )
}

export function HosBalances({ balances }) {
  const items = [
    {
      key: "driving",
      label: "Driving this shift",
      description: "Time behind the wheel since the last 10-hour rest",
    },
    {
      key: "window",
      label: "Current shift",
      description: "Total time since this shift began",
    },
    {
      key: "cycle",
      label: "Estimated cycle balance",
      description: "Entered hours used plus planned on-duty time",
    },
  ]

  return (
    <Paper
      aria-labelledby="hos-title"
      component="section"
      elevation={1}
      sx={{ p: 2.5 }}
    >
      <Typography component="h2" id="hos-title" variant="h6">
        Driver hours at trip end
      </Typography>

      <Stack
        direction="row"
        spacing={1.25}
        sx={{
          alignItems: "center",
          bgcolor: "#f6fef9",
          border: "1px solid #d1fadf",
          borderRadius: 2,
          mt: 2,
          p: 1.5,
        }}
      >
        <Box
          sx={{
            alignItems: "center",
            bgcolor: "#dcfae6",
            borderRadius: "50%",
            color: "#079455",
            display: "flex",
            flex: "0 0 auto",
            height: 32,
            justifyContent: "center",
            width: 32,
          }}
        >
          <CheckCircleRounded sx={{ fontSize: 19 }} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography color="text.primary" fontWeight={700} variant="body2">
            This plan stays within HOS limits
          </Typography>
          <Typography
            color="text.secondary"
            display="block"
            sx={{ mt: 0.125 }}
            variant="caption"
          >
            Required breaks and rests are included. Cycle balance is estimated
            from the entered hours, not a full 8-day history.
          </Typography>
        </Box>
      </Stack>

      <Stack spacing={1.5} sx={{ mt: 2 }}>
        {items.map(({ key, label, description }) => {
          const item = balances[key]
          const usedPercent = Math.min(100, (item.used / item.limit) * 100)
          return (
            <Box
              key={key}
              sx={{
                bgcolor: "background.default",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 2,
                p: 1.75,
              }}
            >
              <Stack
                direction="row"
                spacing={2}
                sx={{ alignItems: "flex-start", justifyContent: "space-between" }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography fontWeight={650} variant="body2">
                    {label}
                  </Typography>
                  <Typography color="text.secondary" variant="caption">
                    {description}
                  </Typography>
                </Box>
                <Box
                  component="span"
                  sx={{
                    bgcolor: "#ecfdf3",
                    borderRadius: 999,
                    color: "#067647",
                    flexShrink: 0,
                    fontSize: 12,
                    fontWeight: 700,
                    lineHeight: 1,
                    px: 1.1,
                    py: 0.7,
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatDurationAsHours(item.remaining)} left
                </Box>
              </Stack>
              <LinearProgress
                aria-label={`${label}: ${formatDurationAsHours(item.used)} used of ${formatDurationAsHours(item.limit)}`}
                color="primary"
                sx={{ borderRadius: 4, height: 6, mt: 1.5 }}
                value={usedPercent}
                variant="determinate"
              />
              <Stack
                direction="row"
                sx={{ justifyContent: "space-between", mt: 0.75 }}
              >
                <Typography color="text.secondary" variant="caption">
                  {formatDurationAsHours(item.used)} used
                </Typography>
                <Typography color="text.secondary" variant="caption">
                  {formatDurationAsHours(item.limit)} maximum
                </Typography>
              </Stack>
            </Box>
          )
        })}
      </Stack>
    </Paper>
  )
}

const ON_DUTY_STATUSES = new Set(["driving", "on_duty_not_driving"])

function groupSegmentsByDay(segments) {
  const days = []
  const byKey = new Map()
  segments.forEach((segment, order) => {
    const key = segment.start.slice(0, 10)
    let day = byKey.get(key)
    if (!day) {
      day = { date: key, rows: [] }
      byKey.set(key, day)
      days.push(day)
    }
    day.rows.push({ segment, order })
  })
  return days
}

function DutySegmentRow({ isFirst, isLast, segment, stop }) {
  const meta = STATUS_META[segment.status]
  const title = stop ? stopLabel(stop.kind) : meta.label
  const details = [
    stop ? `mile ${formatMiles(stop.cumulative_miles, 0)}` : null,
    stop?.note || segment.note || null,
  ].filter(Boolean)

  return (
    <Box
      sx={{
        columnGap: 1.25,
        display: "grid",
        gridTemplateColumns: "20px 52px minmax(0, 1fr)",
        py: 1,
      }}
    >
      <Box sx={{ display: "flex", justifyContent: "center", position: "relative" }}>
        {!isFirst && (
          <Box
            sx={{
              bgcolor: "divider",
              height: 10,
              left: "50%",
              position: "absolute",
              top: 0,
              transform: "translateX(-50%)",
              width: "2px",
            }}
          />
        )}
        {!isLast && (
          <Box
            sx={{
              bgcolor: "divider",
              bottom: 0,
              left: "50%",
              position: "absolute",
              top: 10,
              transform: "translateX(-50%)",
              width: "2px",
            }}
          />
        )}
        <Box
          sx={{
            bgcolor: meta.color,
            borderRadius: "50%",
            boxShadow: `0 0 0 3px ${meta.soft}`,
            flex: "0 0 auto",
            height: 12,
            mt: "4px",
            position: "relative",
            width: 12,
          }}
        />
      </Box>

      <Typography
        component="time"
        sx={{
          color: "text.primary",
          fontSize: 14,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 700,
          lineHeight: "20px",
          whiteSpace: "nowrap",
        }}
      >
        {formatClock(segment.start)}
      </Typography>

      <Box sx={{ minWidth: 0 }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "baseline", justifyContent: "space-between" }}
        >
          <Typography fontWeight={650} variant="body2">
            {title}
          </Typography>
          <Typography
            color="text.secondary"
            sx={{ whiteSpace: "nowrap" }}
            variant="caption"
          >
            {formatDuration(segment.duration_minutes)}
          </Typography>
        </Stack>
        {details.length > 0 && (
          <Typography color="text.secondary" display="block" variant="caption">
            {details.join(" · ")}
          </Typography>
        )}
      </Box>
    </Box>
  )
}

function ScheduleTimeline({ snapshot }) {
  const stopsByStart = new Map(
    snapshot.stops.map((stop) => [stop.start, stop]),
  )
  const days = groupSegmentsByDay(snapshot.duty_segments)

  return (
    <Paper
      aria-labelledby="timeline-title"
      component="section"
      elevation={1}
      sx={{ p: 2.5 }}
    >
      <Typography component="h2" id="timeline-title" variant="h6">
        Duty schedule
      </Typography>
      <Typography color="text.secondary" variant="body2">
        {snapshot.duty_segments.length} segments across {days.length}{" "}
        {days.length === 1 ? "day" : "days"}
      </Typography>

      <Stack
        aria-label="Duty status legend"
        direction="row"
        sx={{ flexWrap: "wrap", gap: 1, my: 2 }}
      >
        {Object.entries(STATUS_META).map(([status, meta]) => (
          <Box
            component="span"
            key={status}
            sx={{
              alignItems: "center",
              bgcolor: "background.paper",
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 999,
              color: "text.secondary",
              display: "inline-flex",
              fontSize: 12,
              fontWeight: 600,
              gap: 0.75,
              lineHeight: 1,
              px: 1.1,
              py: 0.75,
            }}
          >
            <Box
              component="i"
              sx={{
                bgcolor: meta.color,
                borderRadius: "50%",
                display: "block",
                flex: "0 0 auto",
                height: 8,
                width: 8,
              }}
            />
            {meta.label}
          </Box>
        ))}
      </Stack>

      <Box
        aria-label="Trip duty schedule"
        sx={{ maxHeight: { md: 720 }, overflowY: { md: "auto" }, pr: { md: 0.5 } }}
      >
        {days.map((day, dayIndex) => {
          const onDutyMinutes = day.rows.reduce(
            (total, { segment }) =>
              ON_DUTY_STATUSES.has(segment.status)
                ? total + segment.duration_minutes
                : total,
            0,
          )

          return (
            <Box key={day.date}>
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  alignItems: "baseline",
                  bgcolor: "background.paper",
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  justifyContent: "space-between",
                  mb: 0.5,
                  position: "sticky",
                  pt: dayIndex === 0 ? 0 : 1.5,
                  pb: 0.75,
                  top: 0,
                  zIndex: 1,
                }}
              >
                <Typography
                  sx={{ fontWeight: 700, letterSpacing: "0.01em" }}
                  variant="body2"
                >
                  Day {dayIndex + 1}
                  <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>
                    {" · "}
                    {formatDate(day.date, { weekday: "short", short: true, year: false })}
                  </Box>
                </Typography>
                <Typography color="text.secondary" variant="caption">
                  {formatDuration(onDutyMinutes)} on duty
                </Typography>
              </Stack>

              {day.rows.map(({ segment, order }, rowIndex) => (
                <DutySegmentRow
                  isFirst={rowIndex === 0}
                  isLast={rowIndex === day.rows.length - 1}
                  key={`${segment.start}-${segment.status}-${order}`}
                  segment={segment}
                  stop={stopsByStart.get(segment.start)}
                />
              ))}
            </Box>
          )
        })}
      </Box>
    </Paper>
  )
}

function RouteHeader({ onNewTrip, onShare, shareStatus, snapshot }) {
  return (
    <Paper
      className="route-header"
      component="section"
      elevation={1}
      sx={{ p: { xs: 2.5, sm: 3 } }}
    >
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        sx={{
          alignItems: { xs: "flex-start", md: "center" },
          justifyContent: "space-between",
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography color="text.secondary" variant="overline">
            Trip plan
          </Typography>
          <Typography component="h1" variant="h4">
            {snapshot.locations.current.label}
            <Box component="span" sx={{ color: "text.secondary", mx: 1 }}>
              →
            </Box>
            {snapshot.locations.dropoff.label}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75 }}>
            Pickup: {snapshot.locations.pickup.label} · Departure:{" "}
            {formatDate(snapshot.trip.departure_local)} at{" "}
            {formatClock(snapshot.trip.departure_local)}
          </Typography>
        </Box>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <Button
            onClick={onNewTrip}
            startIcon={<AddRoadOutlined />}
            variant="outlined"
          >
            Plan another trip
          </Button>
          <Button
            onClick={onShare}
            startIcon={<ContentCopyOutlined />}
            variant="contained"
          >
            {shareStatus === "copied" ? "Link copied" : "Copy trip link"}
          </Button>
        </Stack>
      </Stack>
      <Divider sx={{ my: 2 }} />
      <Typography color="text.secondary" variant="caption">
        Record ID{" "}
        <Box
          component="code"
          sx={{ color: "text.primary", fontFamily: "monospace", ml: 0.5 }}
        >
          {snapshot.trip.id}
        </Box>
      </Typography>
    </Paper>
  )
}

export default function TripResults({
  onNewTrip,
  onShare,
  shareStatus,
  snapshot,
}) {
  const balances = calculateHosBalances(snapshot)

  return (
    <Container
      className="results-page"
      component="main"
      maxWidth="xl"
      sx={{ py: { xs: 2, sm: 3 } }}
    >
      <Stack spacing={2.5}>
        <RouteHeader
          onNewTrip={onNewTrip}
          onShare={onShare}
          shareStatus={shareStatus}
          snapshot={snapshot}
        />
        <SummaryCards balances={balances} snapshot={snapshot} />
        <Box
          sx={{
            display: "grid",
            gap: 2.5,
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              md: "minmax(0, 2fr) minmax(320px, 0.85fr)",
            },
          }}
        >
          <Stack className="results-main" spacing={2.5} sx={{ minWidth: 0 }}>
            <TripMap snapshot={snapshot} />
            <EldLogSheets snapshot={snapshot} />
          </Stack>
          <Stack
            component="aside"
            className="results-aside"
            spacing={2.5}
            sx={{ minWidth: 0 }}
          >
            <HosBalances balances={balances} />
            <ScheduleTimeline snapshot={snapshot} />
            <Alert severity="info">
              <Typography fontWeight={700} variant="body2">
                Planning assumptions
              </Typography>
              <Typography variant="body2">
                Property-carrying driver; 70-hour/8-day cycle; one hour each
                for pickup and drop-off; fuel at least every 1,000 miles; no
                split sleeper berth or adverse-condition extension.
              </Typography>
            </Alert>
          </Stack>
        </Box>
      </Stack>
    </Container>
  )
}
