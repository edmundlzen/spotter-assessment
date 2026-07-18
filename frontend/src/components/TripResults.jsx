import AddRoadOutlined from "@mui/icons-material/AddRoadOutlined"
import CalendarMonthOutlined from "@mui/icons-material/CalendarMonthOutlined"
import ContentCopyOutlined from "@mui/icons-material/ContentCopyOutlined"
import ScheduleOutlined from "@mui/icons-material/ScheduleOutlined"
import StraightenOutlined from "@mui/icons-material/StraightenOutlined"
import WorkHistoryOutlined from "@mui/icons-material/WorkHistoryOutlined"
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  LinearProgress,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
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

function HosBalances({ balances }) {
  return (
    <Paper
      aria-labelledby="hos-title"
      component="section"
      elevation={1}
      sx={{ p: 2.5 }}
    >
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between", mb: 2.5 }}
      >
        <Typography component="h2" id="hos-title" variant="h6">
          Hours of service
        </Typography>
        <Chip label="70 / 8" size="small" variant="outlined" />
      </Stack>

      <Stack spacing={2.5}>
        {["driving", "window", "cycle"].map((key) => {
          const item = balances[key]
          const usedPercent = Math.min(100, (item.used / item.limit) * 100)
          return (
            <Box key={key}>
              <Stack
                direction="row"
                spacing={2}
                sx={{ justifyContent: "space-between" }}
              >
                <Typography fontWeight={600} variant="body2">
                  {item.label}
                </Typography>
                <Typography fontWeight={700} variant="body2">
                  {formatDuration(item.remaining, { compact: true })}
                </Typography>
              </Stack>
              <LinearProgress
                aria-label={`${item.label}: ${formatDuration(item.remaining)} remaining`}
                sx={{ borderRadius: 4, height: 7, my: 0.75 }}
                value={usedPercent}
                variant="determinate"
              />
              <Typography color="text.secondary" variant="caption">
                {formatDuration(item.used)} used
              </Typography>
            </Box>
          )
        })}
      </Stack>

      <Divider sx={{ my: 2 }} />
      <Typography color="text.secondary" variant="caption">
        Final balances after applying qualifying resets and restarts in this
        plan.
      </Typography>
    </Paper>
  )
}

function ScheduleTimeline({ snapshot }) {
  const stopsByStart = new Map(
    snapshot.stops.map((stop) => [stop.start, stop]),
  )

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
        {snapshot.duty_segments.length} duty-status segments
      </Typography>

      <Stack
        aria-label="Duty status legend"
        direction="row"
        sx={{ flexWrap: "wrap", gap: 1, my: 2 }}
      >
        {Object.entries(STATUS_META).map(([status, meta]) => (
          <Chip
            icon={
              <Box
                component="span"
                sx={{
                  bgcolor: meta.color,
                  borderRadius: "50%",
                  height: 8,
                  width: 8,
                }}
              />
            }
            key={status}
            label={meta.label}
            size="small"
            variant="outlined"
          />
        ))}
      </Stack>

      <List
        aria-label="Trip duty schedule"
        disablePadding
        sx={{ maxHeight: { md: 720 }, overflowY: { md: "auto" } }}
      >
        {snapshot.duty_segments.map((segment, index) => {
          const stop = stopsByStart.get(segment.start)
          const meta = STATUS_META[segment.status]
          const title = stop ? stopLabel(stop.kind) : meta.label
          const details = [
            `${formatClock(segment.start)}–${formatClock(segment.end)}`,
            formatDuration(segment.duration_minutes),
            stop ? `mile ${formatMiles(stop.cumulative_miles, 0)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")

          return (
            <ListItem
              alignItems="flex-start"
              divider={index < snapshot.duty_segments.length - 1}
              key={`${segment.start}-${segment.status}-${index}`}
              sx={{ px: 0, py: 1.5 }}
            >
              <ListItemAvatar sx={{ minWidth: 34, mt: 0.5 }}>
                <Box
                  sx={{
                    bgcolor: meta.color,
                    border: "3px solid",
                    borderColor: meta.soft,
                    borderRadius: "50%",
                    height: 14,
                    width: 14,
                  }}
                />
              </ListItemAvatar>
              <ListItemText
                primary={
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Typography fontWeight={650} variant="body2">
                      {title}
                    </Typography>
                    <Typography color="text.secondary" variant="caption">
                      {formatDate(segment.start, { short: true })}
                    </Typography>
                  </Stack>
                }
                secondary={
                  <>
                    <Typography
                      color="text.secondary"
                      component="span"
                      display="block"
                      variant="caption"
                    >
                      {details}
                    </Typography>
                    {(stop?.note || segment.note) && (
                      <Typography
                        color="text.secondary"
                        component="span"
                        display="block"
                        sx={{ mt: 0.25 }}
                        variant="caption"
                      >
                        {stop?.note || segment.note}
                      </Typography>
                    )}
                  </>
                }
              />
            </ListItem>
          )
        })}
      </List>
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
