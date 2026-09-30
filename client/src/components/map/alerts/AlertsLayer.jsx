import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { connectSocket } from "../../../utils/socket";

const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? `http://${window.location.hostname}:5000`);

const SEV_COLOR = {
  evacuate: "#dc2626",
  warning:  "#f59e0b",
  watch:    "#3b82f6",
};

// Inline SVG paths by incident type
const TYPE_PATH = {
  fire:       `<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>`,
  flood:      `<path d="M2 12h20"/><path d="M2 18h20"/><path d="M6 6c0-1 1-2 3-2s3 1 3 2-1 2-3 2-3-1-3-2z"/><path d="M16 6c0-1 1-2 3-2s3 1 3 2-1 2-3 2-3-1-3-2z"/>`,
  earthquake: `<path d="m2 12 4-8 3 5 3-3 3 6 3-8 4 8"/>`,
  storm:      `<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="m9 14 2 3 3-5"/>`,
  rescue:     `<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>`,
  other:      `<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`,
};

function makeIcon(alert) {
  const isRescue = alert.type === "rescue";
  const color    = isRescue ? "#dc2626" : (SEV_COLOR[alert.severity] ?? "#6b7280");
  const path     = TYPE_PATH[alert.type] ?? TYPE_PATH.other;
  const svg      = `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative">
        <div style="
          background:${color};border:3px solid white;border-radius:50%;
          width:36px;height:36px;display:flex;align-items:center;justify-content:center;
          box-shadow:0 2px 14px rgba(0,0,0,0.35);">${svg}</div>
        ${isRescue ? `<div style="
          position:absolute;top:-4px;right:-4px;
          width:11px;height:11px;background:#dc2626;border:2px solid white;border-radius:50%;
          animation:alertPinPulse 1.5s infinite;"></div>` : ""}
      </div>`,
    iconSize:    [36, 36],
    iconAnchor:  [18, 18],
    popupAnchor: [0, -22],
  });
}

function makePopup(alert) {
  const isRescue  = alert.type === "rescue";
  const color     = isRescue ? "#dc2626" : (SEV_COLOR[alert.severity] ?? "#6b7280");
  const sevLabel  = isRescue ? "🚨 RESCUE" : (alert.severity?.toUpperCase() ?? "—");
  const typeLabel = alert.type?.charAt(0).toUpperCase() + alert.type?.slice(1);
  const time      = alert.createdAt
    ? new Date(alert.createdAt).toLocaleString("en-PH", {
        timeZone: "Asia/Manila", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "";

  return `
    <div style="font-family:system-ui,sans-serif;min-width:230px;max-width:280px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        <span style="background:${color};color:white;font-size:11px;font-weight:700;
                     padding:2px 8px;border-radius:999px">${sevLabel}</span>
        <span style="font-size:11px;color:#6b7280;background:#f3f4f6;
                     padding:2px 6px;border-radius:999px">${typeLabel}</span>
        <span style="font-size:11px;color:#6b7280;background:#f3f4f6;
                     padding:2px 6px;border-radius:999px">${alert.source ?? ""}</span>
      </div>
      <p style="font-weight:700;font-size:14px;margin:0 0 6px;color:#111827;line-height:1.3">
        ${alert.title}
      </p>
      <p style="font-size:12px;color:#374151;margin:0 0 8px;line-height:1.5">
        ${alert.description}
      </p>
      ${alert.location
        ? `<p style="font-size:11px;color:#9ca3af;margin:0 0 4px">📍 ${alert.location}</p>`
        : ""}
      ${time ? `<p style="font-size:10px;color:#9ca3af;margin:0">🕐 ${time}</p>` : ""}
    </div>`;
}

export default function AlertsLayer({ visible }) {
  const map      = useMap();
  const layerRef = useRef(null);

  const buildMarkers = (alerts) => {
    if (!layerRef.current) return;
    layerRef.current.clearLayers();
    if (!visible) return;

    alerts.forEach((alert) => {
      if (alert.lat == null || alert.lng == null) return;
      const marker = L.marker([alert.lat, alert.lng], { icon: makeIcon(alert) });
      marker.bindPopup(makePopup(alert), { maxWidth: 300, minWidth: 240 });
      marker.on("click", (e) => e.originalEvent?.stopPropagation());
      marker.addTo(layerRef.current);
    });
  };

  // Initialize layer group
  useEffect(() => {
    if (!map) return;
    layerRef.current = L.layerGroup().addTo(map);
    return () => { if (layerRef.current) map.removeLayer(layerRef.current); };
  }, [map]);

  // Fetch and render whenever visibility changes
  useEffect(() => {
    if (!layerRef.current) return;
    layerRef.current.clearLayers();
    if (!visible) return;

    const token = localStorage.getItem("token") ?? "";
    fetch(`${API_BASE}/api/alerts`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(({ alerts = [] }) => buildMarkers(alerts))
      .catch(() => {});
  }, [visible]);

  // Live socket updates
  useEffect(() => {
    const socket = connectSocket();

    const refresh = () => {
      if (!visible || !layerRef.current) return;
      const token = localStorage.getItem("token") ?? "";
      fetch(`${API_BASE}/api/alerts`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then(({ alerts = [] }) => buildMarkers(alerts))
        .catch(() => {});
    };

    socket.on("new_alert",     refresh);
    socket.on("alert_updated", refresh);

    return () => {
      socket.off("new_alert",     refresh);
      socket.off("alert_updated", refresh);
    };
  }, [visible]);

  return null;
}
