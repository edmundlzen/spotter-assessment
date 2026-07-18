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

function SummaryIcon({ type }) {
  const paths = {
    distance: "M4 17h16M6 17l3-10 3 6 3-9 3 13",
    clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
    calendar: "M6 3v3m12-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z",
    duty: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0",
  }
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d={paths[type]} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  )
}

function SummaryCards({ snapshot, balances }) {
  const start = Date.parse(`${snapshot.duty_segments[0].start}Z`)
  const end = Date.parse(`${snapshot.duty_segments.at(-1).end}Z`)
  const tripElapsed = Math.round((end - start) / 60_000)
  const items = [
    {
      label: "Route distance",
      value: `${formatMiles(snapshot.summary.total_distance_miles, 0)} mi`,
      detail: `${snapshot.summary.leg_count} route legs`,
      icon: "distance",
    },
    {
      label: "Estimated drive time",
      value: formatDuration(snapshot.summary.total_duration_minutes),
      detail: "Provider road estimate",
      icon: "clock",
    },
    {
      label: "Trip duration",
      value: formatDuration(tripElapsed),
      detail: `${snapshot.summary.log_day_count} daily logs`,
      icon: "calendar",
    },
    {
      label: "Total on-duty time",
      value: formatDuration(balances.totalOnDutyMinutes),
      detail: `${formatDuration(balances.totalDrivingMinutes)} driving`,
      icon: "duty",
    },
  ]

  return (
    <div className="summary-grid" aria-label="Trip summary">
      {items.map((item) => (
        <article className="summary-card" key={item.label}>
          <span className="summary-card__icon">
            <SummaryIcon type={item.icon} />
          </span>
          <div>
            <p>{item.label}</p>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </div>
        </article>
      ))}
    </div>
  )
}

function HosBalances({ balances }) {
  return (
    <section className="content-card hos-card" aria-labelledby="hos-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Hours of Service</p>
          <h2 id="hos-title">Available after this trip</h2>
        </div>
        <span className="compliance-badge">
          <i />
          70-hour / 8-day rules
        </span>
      </div>
      <div className="hos-grid">
        {["driving", "window", "cycle"].map((key) => {
          const item = balances[key]
          const usedPercent = Math.min(100, (item.used / item.limit) * 100)
          return (
            <div className="hos-meter" key={key}>
              <div className="hos-meter__copy">
                <span>{item.label}</span>
                <strong>{formatDuration(item.remaining, { compact: true })}</strong>
              </div>
              <div
                aria-label={`${item.label}: ${formatDuration(item.remaining)} remaining`}
                aria-valuemax={item.limit}
                aria-valuemin="0"
                aria-valuenow={item.used}
                className="hos-meter__track"
                role="progressbar"
              >
                <span style={{ width: `${usedPercent}%` }} />
              </div>
              <small>{formatDuration(item.used)} used</small>
            </div>
          )
        })}
      </div>
      <p className="hos-note">
        Balances reflect the final duty period in this plan. Qualifying 10-hour
        resets and 34-hour restarts are applied automatically.
      </p>
    </section>
  )
}

function ScheduleTimeline({ snapshot }) {
  const stopsByStart = new Map(
    snapshot.stops.map((stop) => [stop.start, stop]),
  )

  return (
    <section className="content-card timeline-card" aria-labelledby="timeline-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Duty schedule</p>
          <h2 id="timeline-title">Trip timeline</h2>
          <p>{snapshot.duty_segments.length} chronological duty changes</p>
        </div>
      </div>

      <div className="status-legend" aria-label="Duty status legend">
        {Object.entries(STATUS_META).map(([status, meta]) => (
          <span key={status}>
            <i style={{ background: meta.color }} />
            {meta.label}
          </span>
        ))}
      </div>

      <ol className="timeline">
        {snapshot.duty_segments.map((segment, index) => {
          const stop = stopsByStart.get(segment.start)
          const meta = STATUS_META[segment.status]
          return (
            <li key={`${segment.start}-${segment.status}-${index}`}>
              <span
                className="timeline__dot"
                style={{ background: meta.color, boxShadow: `0 0 0 4px ${meta.soft}` }}
              />
              <div className="timeline__time">
                <strong>{formatClock(segment.start)}</strong>
                <span>{formatDate(segment.start, { short: true })}</span>
              </div>
              <div className="timeline__event">
                <div>
                  <strong>{stop ? stopLabel(stop.kind) : meta.label}</strong>
                  <span className="status-pill" style={{ color: meta.color, background: meta.soft }}>
                    {meta.label}
                  </span>
                </div>
                <p>
                  {formatClock(segment.start)}–{formatClock(segment.end)} ·{" "}
                  {formatDuration(segment.duration_minutes)}
                  {stop
                    ? ` · mile ${formatMiles(stop.cumulative_miles, 0)}`
                    : ""}
                </p>
                {(stop?.note || segment.note) && (
                  <small>{stop?.note || segment.note}</small>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function RouteHeader({ onNewTrip, onShare, shareStatus, snapshot }) {
  return (
    <section className="result-hero">
      <div>
        <div className="result-hero__status">
          <span>Route ready</span>
          <small>Saved trip</small>
        </div>
        <p className="eyebrow">Trip plan</p>
        <h1>
          {snapshot.locations.current.label}
          <span aria-hidden="true"> → </span>
          {snapshot.locations.dropoff.label}
        </h1>
        <p className="result-hero__via">
          Pickup in {snapshot.locations.pickup.label} · Departing{" "}
          {formatDate(snapshot.trip.departure_local)} at{" "}
          {formatClock(snapshot.trip.departure_local)}
        </p>
      </div>
      <div className="result-actions">
        <button className="outlined-button" onClick={onNewTrip} type="button">
          Plan another trip
        </button>
        <button className="primary-button" onClick={onShare} type="button">
          {shareStatus === "copied" ? "Link copied" : "Share trip"}
        </button>
      </div>
      <div className="record-reference">
        <span>Shareable record</span>
        <code>{snapshot.trip.id}</code>
      </div>
    </section>
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
    <main className="results-page">
      <RouteHeader
        onNewTrip={onNewTrip}
        onShare={onShare}
        shareStatus={shareStatus}
        snapshot={snapshot}
      />
      <SummaryCards balances={balances} snapshot={snapshot} />
      <div className="results-grid">
        <div className="results-grid__main">
          <TripMap snapshot={snapshot} />
          <EldLogSheets snapshot={snapshot} />
        </div>
        <aside className="results-grid__aside">
          <HosBalances balances={balances} />
          <ScheduleTimeline snapshot={snapshot} />
          <section className="assumptions-card">
            <strong>Planning assumptions</strong>
            <p>
              Property-carrying driver · 70-hour/8-day cycle · 1-hour pickup
              and drop-off · fuel at least every 1,000 miles · no split sleeper
              berth or adverse-condition extension.
            </p>
          </section>
        </aside>
      </div>
    </main>
  )
}

