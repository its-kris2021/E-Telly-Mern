import { useEffect, useState } from "react";
import { Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";

// Flood susceptibility zone markers — smaller than FloodAlertsLayer alert markers
// so users can tell them apart at a glance (32px zone vs 42px live-alert).
// Colors mirror FloodAlertsLayer's severity palette:
//   risk 3 (High)     → warning amber
//   risk 2 (Moderate) → watch blue

const ZONE_STYLE = {
  3: { border: "#b45309", bg: "#fffbeb", icon: "#b45309", label: "High Flood Susceptibility" },
  2: { border: "#3b82f6", bg: "#eff6ff", icon: "#3b82f6", label: "Moderate Flood Susceptibility" },
};

const WAVES_SVG = (color, size = 16) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
    <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
    <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
  </svg>`;

function createZoneIcon(risk) {
  const s = ZONE_STYLE[risk] ?? ZONE_STYLE[2];
  return L.divIcon({
    className: "",
    html: `
      <div style="
        width:32px;height:32px;
        background:${s.bg};
        border:2px solid ${s.border};
        border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 1px 6px rgba(0,0,0,0.12);
        opacity:0.85;
      ">
        ${WAVES_SVG(s.icon, 16)}
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
}

const userDotIcon = L.divIcon({
  className: "",
  html: `
    <div style="position:relative;width:20px;height:20px;">
      <div style="position:absolute;inset:0;border-radius:50%;
                  background:#3b82f6;opacity:0.25;
                  animation:pulse-ring 1.5s ease-out infinite;"></div>
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
                  width:12px;height:12px;border-radius:50%;
                  background:#3b82f6;border:2px solid white;
                  box-shadow:0 0 6px rgba(59,130,246,0.6);"></div>
    </div>
  `,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

export const UserLocationMarker = ({ onLocated }) => {
  const [position, setPosition] = useState(null);
  const map = useMap();

  useEffect(() => {
    if (!navigator.geolocation) return;

    let watchId;

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const coords = [pos.coords.latitude, pos.coords.longitude];
        setPosition(coords);
        onLocated?.(coords);

        if (pos.coords.accuracy <= 50) {
          navigator.geolocation.clearWatch(watchId);
        }
      },
      (err) => console.warn("Geolocation:", err.message),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [map]);

  if (!position) return null;

  return (
    <Marker position={position} icon={userDotIcon}>
      <Popup>
        <div className="text-sm">
          <p className="font-semibold text-gray-800">📍 Your Location</p>
          <p className="text-gray-500 text-xs mt-0.5">
            {position[0].toFixed(5)}°N, {position[1].toFixed(5)}°E
          </p>
        </div>
      </Popup>
    </Marker>
  );
};

const FloodLayer = ({ visible }) => {
  const [zones, setZones] = useState([]);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;

    fetch("/api/hazard/flood-zones")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setZones(data.zones ?? []);
      })
      .catch((err) => console.warn("FloodLayer:", err.message));

    return () => {
      cancelled = true;
    };
  }, [visible]);

  if (!visible || zones.length === 0) return null;

  // Only show flood-susceptible barangays (moderate or high risk)
  const susceptibleZones = zones.filter((z) => z.risk >= 2);

  return (
    <>
      {susceptibleZones.map((zone) => {
        const s = ZONE_STYLE[zone.risk] ?? ZONE_STYLE[2];

        return (
          <Marker
            key={zone.id ?? zone.name}
            position={[zone.lat, zone.lng]}
            icon={createZoneIcon(zone.risk)}
          >
            <Popup>
              <div className="min-w-[190px]">
                <div className="flex items-center gap-2 mb-1.5">
                  <span>🌊</span>
                  <span className="font-semibold text-sm text-gray-800">
                    {zone.name}
                  </span>
                </div>
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
                  style={{ backgroundColor: s.border }}
                >
                  {s.label}
                </span>
                <div className="mt-2 flex flex-col gap-0.5 text-xs text-gray-500">
                  <p>
                    📏 Avg. elevation:{" "}
                    <span className="font-semibold text-gray-700">
                      {zone.avgElevationM} m ASL
                    </span>
                  </p>
                  {zone.nearRiver && (
                    <p className="text-blue-600 font-medium">
                      🌊 Near river / drainage corridor
                    </p>
                  )}
                </div>
                <p className="text-[10px] text-gray-400 mt-2">
                  Susceptibility zone — NDRRMC flood hazard map
                </p>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
};

export default FloodLayer;
