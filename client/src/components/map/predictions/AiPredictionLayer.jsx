// Renders AI-predicted hazard markers (Alert.source === "ai") — statistical
// predictions from services/predictionEngine.js, distinct from confirmed
// rule-based alerts (FloodAlertsLayer/LandslideAlertsLayer) and citizen
// reports (ReportsLayer). Visually distinguished with a dashed border and a
// "not yet confirmed" badge so they never read as more authoritative than a
// PAGASA-threshold-triggered alert. Follows the same layer-group/fetch
// pattern as FloodAlertsLayer.jsx.

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? `http://${window.location.hostname}:5000`);

const SPARKLE_SVG = (color, size = 18) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>
    <circle cx="12" cy="12" r="2.5"/>
  </svg>`;

const SEVERITY_COLOR = {
  watch: "#3b82f6",
  warning: "#f59e0b",
  critical: "#dc2626",
  evacuate: "#dc2626",
};

function createAiIcon(severity) {
  const color = SEVERITY_COLOR[severity] ?? SEVERITY_COLOR.watch;
  return L.divIcon({
    className: "",
    html: `
      <div style="
        width:38px;height:38px;border-radius:50%;
        background:#ffffff;
        border:2.5px dashed ${color};
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 2px 10px rgba(0,0,0,0.15);
      ">
        ${SPARKLE_SVG(color, 18)}
      </div>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -22],
  });
}

let handlersInstalled = false;
function installGlobalHandlers(onAction) {
  if (handlersInstalled) return;
  handlersInstalled = true;
  window.__aiAlertConfirm = (id) => onAction(id, "confirm");
  window.__aiAlertReject  = (id) => onAction(id, "reject");
}

function createAiPopup(alert, canModerate) {
  const color = SEVERITY_COLOR[alert.severity] ?? SEVERITY_COLOR.watch;
  const confidencePct = alert.confidence != null ? Math.round(alert.confidence * 100) : null;
  const time = alert.createdAt
    ? new Date(alert.createdAt).toLocaleString("en-PH", {
        timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : "";
  const outcome = alert.confirmedOutcome ?? "unconfirmed";

  const outcomeBadge =
    outcome === "true_positive"
      ? `<span style="background:#dcfce7;color:#166534;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;">CONFIRMED</span>`
      : outcome === "false_positive"
        ? `<span style="background:#f3f4f6;color:#6b7280;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;">MARKED FALSE POSITIVE</span>`
        : `<span style="background:#ede9fe;color:#5b21b6;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;">NOT YET CONFIRMED</span>`;

  const actionButtons =
    canModerate && outcome === "unconfirmed"
      ? `
        <div style="display:flex;gap:6px;margin-top:10px;">
          <button onclick="window.__aiAlertConfirm('${alert._id}')" style="
            flex:1;background:#16a34a;color:white;border:none;border-radius:8px;
            font-size:11px;font-weight:600;padding:6px 0;cursor:pointer;">
            Confirm — hazard occurred
          </button>
          <button onclick="window.__aiAlertReject('${alert._id}')" style="
            flex:1;background:#f3f4f6;color:#374151;border:none;border-radius:8px;
            font-size:11px;font-weight:600;padding:6px 0;cursor:pointer;">
            Mark false positive
          </button>
        </div>`
      : "";

  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;min-width:230px;max-width:290px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <div style="
          width:30px;height:30px;border-radius:50%;background:#fff;
          border:2px dashed ${color};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          ${SPARKLE_SVG(color, 15)}
        </div>
        <div style="font-weight:700;font-size:13px;color:#111827;line-height:1.2;">${alert.title}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
        <span style="background:#f3f4f6;color:#374151;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;">
          AI PREDICTION${confidencePct != null ? ` · ${confidencePct}% confidence` : ""}
        </span>
        ${outcomeBadge}
      </div>
      <p style="font-size:12px;color:#4b5563;line-height:1.5;margin:0 0 8px 0;">
        ${alert.description.length > 220 ? alert.description.slice(0, 217) + "…" : alert.description}
      </p>
      <div style="border-top:1px solid #f3f4f6;padding-top:6px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:10px;color:#9ca3af;">${alert.modelVersion ?? ""}</span>
        <span style="font-size:10px;color:#9ca3af;">${time}</span>
      </div>
      ${actionButtons}
    </div>
  `;
}

function getAlertCoords(alert) {
  if (alert.lat != null && alert.lng != null) return [alert.lat, alert.lng];
  if (!alert.location) return null;
  const parts = alert.location.split(",");
  if (parts.length !== 2) return null;
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  return [lat, lon];
}

export default function AiPredictionLayer({ visible }) {
  const map = useMap();
  const layerRef = useRef(null);
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const canModerate = Boolean(token);

  const load = () => {
    if (!layerRef.current) return;
    layerRef.current.clearLayers();
    if (!visible) return;

    fetch(`${API_BASE}/api/alerts`)
      .then((r) => r.json())
      .then(({ alerts = [] }) => {
        const aiAlerts = alerts.filter((a) => a.source === "ai" && a.isActive);

        aiAlerts.forEach((alert) => {
          const coords = getAlertCoords(alert);
          if (!coords) return;

          const marker = L.marker(coords, {
            icon: createAiIcon(alert.severity),
            zIndexOffset: 400,
          });
          marker.bindPopup(createAiPopup(alert, canModerate), { maxWidth: 310, minWidth: 250 });
          marker.addTo(layerRef.current);
        });

        console.log(`[AiPredictionLayer] Rendered ${aiAlerts.length} AI prediction marker(s)`);
      })
      .catch((err) => console.warn("[AiPredictionLayer] Failed to fetch alerts:", err.message));
  };

  useEffect(() => {
    installGlobalHandlers(async (id, action) => {
      try {
        await fetch(`${API_BASE}/api/alerts/${id}/${action}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` },
        });
        map.closePopup();
        load();
      } catch (err) {
        console.warn(`[AiPredictionLayer] ${action} failed:`, err.message);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    layerRef.current = L.layerGroup().addTo(map);
    return () => {
      if (layerRef.current) map.removeLayer(layerRef.current);
    };
  }, [map]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return null;
}
