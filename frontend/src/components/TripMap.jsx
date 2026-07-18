import { useEffect, useMemo } from "react"
import L from "leaflet"
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet"

import { formatClock, formatMiles, routePositions, stopLabel } from "../utils/trip.js"

function FitRoute({ positions }) {
  const map = useMap()

  useEffect(() => {
    if (positions.length > 1) {
      map.fitBounds(L.latLngBounds(positions), {
        padding: [36, 36],
        maxZoom: 8,
      })
    }
  }, [map, positions])

  return null
}

function markerIcon(label, tone, small = false) {
  return L.divIcon({
    className: "map-marker-shell",
    html: `<span class="map-marker map-marker--${tone}${small ? " map-marker--small" : ""}"><b>${label}</b></span>`,
    iconAnchor: small ? [13, 13] : [18, 18],
    iconSize: small ? [26, 26] : [36, 36],
    popupAnchor: [0, small ? -13 : -18],
  })
}

const LOCATION_MARKERS = [
  ["current", "A", "origin"],
  ["pickup", "B", "pickup"],
  ["dropoff", "C", "dropoff"],
]

const STOP_SYMBOLS = {
  fuel: "F",
  break: "B",
  reset: "R",
  restart: "34",
  pickup: "P",
  dropoff: "D",
}

export default function TripMap({ snapshot }) {
  const positions = useMemo(() => routePositions(snapshot), [snapshot])
  const center = positions[Math.floor(positions.length / 2)] ?? [39, -96]

  return (
    <section className="content-card map-card" aria-labelledby="route-map-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Route overview</p>
          <h2 id="route-map-title">Your planned route</h2>
        </div>
        <span className="section-chip">Heavy goods vehicle</span>
      </div>

      <div className="map-frame">
        <MapContainer
          center={center}
          className="trip-map"
          scrollWheelZoom={false}
          zoom={5}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Polyline
            pathOptions={{ color: "#0b57d0", opacity: 0.92, weight: 5 }}
            positions={positions}
            smoothFactor={2}
          />
          <FitRoute positions={positions} />

          {LOCATION_MARKERS.map(([role, label, tone]) => {
            const location = snapshot.locations[role]
            return (
              <Marker
                icon={markerIcon(label, tone)}
                key={role}
                position={[location.coordinate[1], location.coordinate[0]]}
                title={location.label}
              >
                <Popup>
                  <strong>
                    {role === "current"
                      ? "Current location"
                      : role === "pickup"
                        ? "Pickup"
                        : "Drop-off"}
                  </strong>
                  <br />
                  {location.label}
                </Popup>
              </Marker>
            )
          })}

          {snapshot.stops
            .filter((stop) => !["pickup", "dropoff"].includes(stop.kind))
            .map((stop, index) => (
              <Marker
                icon={markerIcon(
                  STOP_SYMBOLS[stop.kind] ?? "•",
                  stop.kind === "fuel" ? "fuel" : "rest",
                  true,
                )}
                key={`${stop.kind}-${stop.start}-${index}`}
                position={[stop.coordinate[1], stop.coordinate[0]]}
                title={stopLabel(stop.kind)}
              >
                <Popup>
                  <strong>{stopLabel(stop.kind)}</strong>
                  <br />
                  {formatMiles(stop.cumulative_miles, 0)} mi ·{" "}
                  {formatClock(stop.start)}
                </Popup>
              </Marker>
            ))}
        </MapContainer>

        <div className="map-legend" aria-label="Map marker legend">
          <span>
            <i className="legend-dot legend-dot--pickup" /> Pickup
          </span>
          <span>
            <i className="legend-dot legend-dot--dropoff" /> Drop-off
          </span>
          <span>
            <i className="legend-dot legend-dot--fuel" /> Fuel
          </span>
          <span>
            <i className="legend-dot legend-dot--rest" /> Rest
          </span>
        </div>
      </div>
    </section>
  )
}
