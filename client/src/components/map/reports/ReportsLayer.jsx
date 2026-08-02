import { useEffect, useState, useRef, useMemo } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { connectSocket } from "../../../utils/socket";

const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? "http://localhost:5000");

// ── Icon definitions (type → SVG + color) ────────────────────────────────────
const ICON_SVGS = {
  flood: {
    path: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 12h20"/><path d="M2 18h20"/><path d="M6 6c0-1 1-2 3-2s3 1 3 2-1 2-3 2-3-1-3-2z"/>
      <path d="M16 6c0-1 1-2 3-2s3 1 3 2-1 2-3 2-3-1-3-2z"/>
    </svg>`,
    color: "#06b6d4",
  },
  rescue: {
    path: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 18v-6a5 5 0 1 1 10 0v6"/>
      <path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"/>
      <path d="M21 12h1"/><path d="M18.5 4.5 18 5"/><path d="M2 12h1"/><path d="M12 2v1"/><path d="m4.929 4.929.707.707"/><path d="M12 12v6"/>
    </svg>`,
    color: "#ef4444",
  },
  medical: {
    path: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/>
      <path d="M12 8v8m-4-4h8"/>
    </svg>`,
    color: "#ec4899",
  },
  earthquake: {
    path: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="m2 12 4-8 3 5 3-3 3 6 3-8 4 8"/>
    </svg>`,
    color: "#f97316",
  },
  landslide: {
    path: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="m8 3 4 8 5-5 5 15H2L8 3z"/>
    </svg>`,
    color: "#8b5cf6",
  },
  fire: {
    path: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
    </svg>`,
    color: "#dc2626",
  },
  storm: {
    path: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
      <path d="m9 14 2 3 3-5"/>
    </svg>`,
    color: "#7c3aed",
  },
  other: {
    path: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>`,
    color: "#6b7280",
  },
};

// ── Severity/type → visual style ─────────────────────────────────────────────
const TYPE_STYLE = {
  flood: { bg: "#ecfeff", border: "#06b6d4", icon: "#06b6d4", pulse: false },
  rescue: { bg: "#fef2f2", border: "#ef4444", icon: "#ef4444", pulse: true },
  medical: { bg: "#fdf2f8", border: "#ec4899", icon: "#ec4899", pulse: false },
  earthquake: {
    bg: "#fff7ed",
    border: "#f97316",
    icon: "#f97316",
    pulse: false,
  },
  landslide: {
    bg: "#f5f3ff",
    border: "#8b5cf6",
    icon: "#8b5cf6",
    pulse: false,
  },
  fire: { bg: "#fef2f2", border: "#dc2626", icon: "#dc2626", pulse: true },
  storm: { bg: "#f5f3ff", border: "#7c3aed", icon: "#7c3aed", pulse: false },
  other: { bg: "#f9fafb", border: "#6b7280", icon: "#6b7280", pulse: false },
};

const ALERT_SEVERITY_STYLE = {
  evacuate: { bg: "#fef2f2", border: "#dc2626", pulse: true },
  critical: { bg: "#fef2f2", border: "#dc2626", pulse: true },
  warning: { bg: "#fffbeb", border: "#f59e0b", pulse: false },
  watch: { bg: "#eff6ff", border: "#3b82f6", pulse: false },
};

// ── Community report marker ───────────────────────────────────────────────────
const createReportIcon = (type, severity) => {
  const s = TYPE_STYLE[type?.toLowerCase()] || TYPE_STYLE.other;

  const iconDef = ICON_SVGS[type?.toLowerCase()] || ICON_SVGS.other;

  const coloredSvg = iconDef.path.replace(
    'stroke="currentColor"',
    `stroke="${s.icon}"`,
  );
  const shouldPulse = s.pulse || severity === "high";

  return L.divIcon({
    className: "custom-report-marker",
    html: `
      <div style="position:relative;width:40px;height:40px;">
        ${shouldPulse ? `<div class="report-marker-pulse" style="position:absolute;inset:0;border-radius:50%;border:2px solid ${s.border};opacity:0.4;"></div>` : ""}
        <div style="position:absolute;inset:0;background:${s.bg};border:2.5px solid ${s.border};border-radius:50%;display:flex;align-items:center;justify-content:center;">
          ${coloredSvg}
        </div>
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -20],
  });
};

// ── Official alert marker ─────────────────────────────────────────────────────
const createAlertIcon = (type, severity) => {
  const s = ALERT_SEVERITY_STYLE[severity] ?? {
    bg: "#f9fafb",
    border: "#6b7280",
    pulse: false,
  };
  const iconDef = ICON_SVGS[type?.toLowerCase()] || ICON_SVGS.other;
  const coloredSvg = iconDef.path.replace(
    'stroke="currentColor"',
    `stroke="${s.border}"`,
  );

  return L.divIcon({
    className: "custom-alert-marker",
    html: `
      <div style="position:relative;width:38px;height:38px;">
        ${s.pulse ? `<div class="report-marker-pulse" style="position:absolute;inset:0;border-radius:50%;border:2px solid ${s.border};opacity:0.4;"></div>` : ""}
        <div style="position:absolute;inset:0;background:${s.bg};border:2.5px solid ${s.border};border-radius:50%;display:flex;align-items:center;justify-content:center;">
          ${coloredSvg}
        </div>
      </div>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -22],
  });
};

// ── Shared CSS ────────────────────────────────────────────────────────────────
const style = document.createElement("style");
style.textContent = `
  @keyframes report-marker-pulse {
    0%   { transform: scale(1);    opacity: 1; }
    50%  { transform: scale(1.35); opacity: 0.6; }
    100% { transform: scale(1);    opacity: 1; }
  }
  .report-marker-pulse { animation: report-marker-pulse 1.8s ease-in-out infinite; }
  .report-popup { font-family: system-ui, -apple-system, sans-serif; }
  .report-popup img { cursor: pointer; transition: transform 0.2s; }
  .report-popup img:hover { transform: scale(1.05); }
`;
document.head.appendChild(style);

// ── Inline SVG icons for popup metadata ──────────────────────────────────────
const PIN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
const CLOCK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
const USER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
const SIREN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#991b1b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2a1 1 0 0 1 2 0v1a1 1 0 0 1-2 0z"/><path d="m5.2 5.2-.8-.8a1 1 0 0 1 1.4-1.4l.8.8a1 1 0 0 1-1.4 1.4z"/><path d="M2 11h1a1 1 0 0 1 0 2H2a1 1 0 0 1 0-2z"/><path d="m19.6 4.4.8-.8a1 1 0 0 1 1.4 1.4l-.8.8a1 1 0 0 1-1.4-1.4z"/><path d="M21 11h1a1 1 0 0 1 0 2h-1a1 1 0 0 1 0-2z"/><path d="M7 17h10"/><path d="M9 17V9a3 3 0 0 1 6 0v8"/><path d="M5 21h14a2 2 0 0 0 0-4H5a2 2 0 0 0 0 4z"/></svg>`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function isLocalDevicePath(src) {
  if (!src || typeof src !== "string") return false;
  return (
    src.startsWith("/data/") ||
    src.startsWith("/storage/") ||
    src.startsWith("/var/mobile/") ||
    src.startsWith("content://") ||
    src.startsWith("file:///data/")
  );
}

// ── Extract coordinates from a report object ──────────────────────────────────
function extractCoordinates(report) {
  const toNum = (v) => {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };
  const valid = (lat, lng) =>
    lat !== null &&
    lng !== null &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180;

  {
    const lat = toNum(report.latitude);
    const lng = toNum(report.longitude);
    if (valid(lat, lng)) return [lat, lng];
  }

  if (report.location) {
    const loc = report.location;
    {
      const lat = toNum(loc.lat);
      const lng = toNum(loc.lng);
      if (valid(lat, lng)) return [lat, lng];
    }
    {
      const lat = toNum(loc.latitude);
      const lng = toNum(loc.longitude);
      if (valid(lat, lng)) return [lat, lng];
    }
    if (loc.coordinates && !Array.isArray(loc.coordinates)) {
      const lat = toNum(loc.coordinates.latitude);
      const lng = toNum(loc.coordinates.longitude);
      if (valid(lat, lng)) return [lat, lng];
    }
    if (Array.isArray(loc.coordinates) && loc.coordinates.length >= 2) {
      const lng = toNum(loc.coordinates[0]);
      const lat = toNum(loc.coordinates[1]);
      if (valid(lat, lng)) return [lat, lng];
    }
    if (Array.isArray(loc) && loc.length >= 2) {
      const lat = toNum(loc[0]);
      const lng = toNum(loc[1]);
      if (valid(lat, lng)) return [lat, lng];
    }
  }

  if (report.coords) {
    const lat = toNum(report.coords.latitude);
    const lng = toNum(report.coords.longitude);
    if (valid(lat, lng)) return [lat, lng];
  }

  return null;
}

// ── Report popup HTML ─────────────────────────────────────────────────────────
function createReportPopup(report) {
  const time = new Date(report.timestamp).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const location =
    report.location?.exactAddress ||
    report.location?.barangay ||
    "Location not specified";
  const userName = report.userData?.fullName || report.userName || "Anonymous";

  const images = report.images || [];
  const remoteImages = images.filter((src) => !isLocalDevicePath(src));
  const hasLocalOnlyImages = images.length > 0 && remoteImages.length === 0;
  const hasImages = remoteImages.length > 0;

  const severityColors = {
    high: { bg: "#fee2e2", color: "#991b1b", dot: "#ef4444", label: "HIGH" },
    medium: {
      bg: "#fef3c7",
      color: "#92400e",
      dot: "#f59e0b",
      label: "MEDIUM",
    },
    low: { bg: "#dbeafe", color: "#1e40af", dot: "#3b82f6", label: "LOW" },
  };
  const sev = severityColors[report.severity?.toLowerCase()];
  const severityHtml = sev
    ? `<span style="background:${sev.bg};color:${sev.color};font-size:11px;font-weight:700;
        padding:2px 8px;border-radius:999px;display:inline-flex;align-items:center;gap:4px;">
        <span style="width:8px;height:8px;border-radius:50%;background:${sev.dot};display:inline-block;"></span>
        ${sev.label}
      </span>`
    : "";

  return `
    <div class="report-popup">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <h3 style="font-weight:700;font-size:16px;margin:0;color:#1f2937;">
          ${report.emergencyType?.toUpperCase() || "REPORT"}
        </h3>
        ${severityHtml}
      </div>
      ${
        hasImages
          ? `
        <div style="margin-bottom:12px;">
          <img src="${remoteImages[0]}" alt="Report"
            onclick="window.open('${remoteImages[0]}', '_blank')"
            style="width:100%;max-height:150px;object-fit:cover;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);" />
          ${remoteImages.length > 1 ? `<p style="font-size:11px;color:#6b7280;margin-top:4px;text-align:center;">+${remoteImages.length - 1} more image(s)</p>` : ""}
        </div>
      `
          : hasLocalOnlyImages
            ? `
        <div style="background:#f3f4f6;border-radius:8px;padding:12px;margin-bottom:12px;text-align:center;color:#6b7280;font-size:12px;">
          <p style="margin:0;">Image saved on device only — not uploaded to server</p>
        </div>
      `
            : ""
      }
      <p style="font-size:14px;margin:12px 0;color:#374151;line-height:1.5;">
        ${report.description || "No description provided"}
      </p>
      <div style="background:#f9fafb;padding:8px 12px;border-radius:6px;margin:12px 0;font-size:12px;">
        <div style="display:flex;gap:8px;margin-bottom:6px;align-items:center;">
          ${PIN_ICON}<span style="color:#6b7280;min-width:65px;">Location:</span>
          <span style="color:#1f2937;font-weight:500;">${location}</span>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:6px;align-items:center;">
          ${CLOCK_ICON}<span style="color:#6b7280;min-width:65px;">Time:</span>
          <span style="color:#1f2937;">${time}</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          ${USER_ICON}<span style="color:#6b7280;min-width:65px;">Reported by:</span>
          <span style="color:#1f2937;">${userName}</span>
        </div>
      </div>
      ${
        report.emergencyType === "rescue"
          ? `
        <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:8px 12px;border-radius:4px;margin-top:12px;display:flex;align-items:center;gap:8px;">
          ${SIREN_ICON}
          <p style="margin:0;font-size:13px;color:#991b1b;font-weight:600;">RESCUE NEEDED — Urgent response required</p>
        </div>
      `
          : ""
      }
      <p style="font-size:10px;color:#9ca3af;margin-top:12px;margin-bottom:0;text-align:right;">
        Report ID: ${report._id?.slice(-6) || "N/A"}
      </p>
    </div>`;
}

// ── Alert popup HTML ──────────────────────────────────────────────────────────
function createAlertPopup(alert) {
  const isRescue = alert.type === "rescue";
  const sevMap = {
    evacuate: { bg: "#fee2e2", color: "#991b1b", label: "EVACUATE" },
    warning: { bg: "#fef3c7", color: "#92400e", label: "WARNING" },
    watch: { bg: "#dbeafe", color: "#1e40af", label: "WATCH" },
  };
  const sev = isRescue
    ? { bg: "#fee2e2", color: "#991b1b", label: "🚨 RESCUE" }
    : (sevMap[alert.severity] ?? {
        bg: "#f3f4f6",
        color: "#374151",
        label: (alert.severity ?? "—").toUpperCase(),
      });

  const time = alert.createdAt
    ? new Date(alert.createdAt).toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const typeLabel = alert.type
    ? alert.type.charAt(0).toUpperCase() + alert.type.slice(1)
    : "";

  const sourceLabel = alert.source ? `${alert.source} Advisory` : "Official Advisory";

  return `
    <div style="font-family:system-ui,sans-serif;min-width:230px;max-width:280px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        <span style="background:${sev.bg};color:${sev.color};font-size:11px;font-weight:700;
                     padding:2px 8px;border-radius:999px">${sev.label}</span>
        <span style="font-size:11px;color:#6b7280;background:#f3f4f6;
                     padding:2px 6px;border-radius:999px">${typeLabel}</span>
      </div>
      <p style="font-weight:700;font-size:14px;margin:0 0 4px;color:#111827;line-height:1.3">
        ${sourceLabel}
      </p>
      <p style="font-size:12px;font-weight:500;color:#374151;margin:0 0 6px;line-height:1.3">
        ${alert.title ?? "—"}
      </p>
      <p style="font-size:12px;color:#374151;margin:0 0 8px;line-height:1.5">
        ${alert.description ?? ""}
      </p>
      ${
        alert.location
          ? `
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">
          ${PIN_ICON}<span style="font-size:11px;color:#9ca3af;">${alert.location}</span>
        </div>`
          : ""
      }
      ${
        time
          ? `
        <div style="display:flex;gap:6px;align-items:center;">
          ${CLOCK_ICON}<span style="font-size:10px;color:#9ca3af;">${time}</span>
        </div>`
          : ""
      }
      <p style="font-size:9px;color:#d1d5db;margin-top:10px;margin-bottom:0;text-align:right;
                letter-spacing:0.05em;">OFFICIAL ALERT</p>
    </div>`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ReportsLayer({ visible, filters = {}, showAlerts = true }) {
  const map = useMap();
  const [reports, setReports] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const markersLayerRef = useRef(null);

  const fetchApprovedReports = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/reports/approved`, { cache: "no-store" });
      const data = await res.json();
      if (data.success && data.reports) setReports(data.reports);
    } catch {}
  };

  const fetchAlerts = async () => {
    try {
      const token = localStorage.getItem("token") ?? "";
      const res = await fetch(`${API_BASE}/api/alerts`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await res.json();
      const active = (data.alerts ?? []).filter(
        (a) => a.lat != null && a.lng != null,
      );
      setAlerts(active);
    } catch {}
  };

  // Memoize so markers aren't rebuilt on every parent re-render (e.g. clock tick)
  const filteredReports = useMemo(() => {
    if (
      !filters.types ||
      filters.types.length === 0 ||
      filters.types.includes("all")
    ) {
      return reports;
    }
    return reports.filter((r) =>
      filters.types.includes(r.emergencyType?.toLowerCase()),
    );
  }, [reports, filters]);

  // Initialize markers layer
  useEffect(() => {
    if (!map) return;
    markersLayerRef.current = L.layerGroup().addTo(map);
    return () => {
      if (markersLayerRef.current) map.removeLayer(markersLayerRef.current);
    };
  }, [map]);

  // Rebuild markers when visibility, reports, alerts, or filters change
  useEffect(() => {
    if (!markersLayerRef.current) return;
    markersLayerRef.current.clearLayers();
    if (!visible) return;

    // Community reports
    filteredReports.forEach((report) => {
      if (!report) return;
      const coords = extractCoordinates(report);
      if (!coords) return;

      const marker = L.marker(coords, {
        icon: createReportIcon(report.emergencyType, report.severity),
      });
      marker.bindPopup(createReportPopup(report), {
        maxWidth: 300,
        minWidth: 250,
      });
      marker.on("click", (e) => L.DomEvent.stop(e.originalEvent));
      marker.addTo(markersLayerRef.current);
    });

    // Official alerts — only when the reports layer is explicitly on (hazard layers handle their own)
    if (showAlerts) {
      alerts.forEach((alert) => {
        const marker = L.marker([alert.lat, alert.lng], {
          icon: createAlertIcon(alert.type, alert.severity),
        });
        marker.bindPopup(createAlertPopup(alert), {
          maxWidth: 300,
          minWidth: 250,
        });
        marker.on("click", (e) => L.DomEvent.stop(e.originalEvent));
        marker.addTo(markersLayerRef.current);
      });
    }
  }, [visible, filteredReports, alerts, showAlerts, map]);

  // Socket + initial fetch
  useEffect(() => {
    const socket = connectSocket();

    fetchApprovedReports();
    fetchAlerts();

    socket.on("new_emergency_report", (newReport) => {
      if (newReport.status === "approved") {
        setReports((prev) => {
          if (prev.some((r) => r._id === newReport._id)) return prev;
          return [...prev, newReport];
        });
      }
    });

    socket.on("report_status_updated", ({ reportId, status, report }) => {
      if (status === "approved") {
        if (!report) {
          fetchApprovedReports();
          return;
        }
        setReports((prev) => {
          const id = String(reportId);
          const exists = prev.some((r) => String(r._id) === id);
          return exists
            ? prev.map((r) => (String(r._id) === id ? report : r))
            : [...prev, report];
        });
      } else {
        // Optimistically remove then confirm via refetch
        setReports((prev) => prev.filter((r) => String(r._id) !== String(reportId)));
        fetchApprovedReports();
      }
    });

    socket.on("new_alert", fetchAlerts);
    socket.on("alert_updated", ({ id, isActive } = {}) => {
      if (isActive === false && id) {
        setAlerts((prev) => prev.filter((a) => String(a._id) !== String(id)));
      }
      fetchAlerts();
    });

    const refreshInterval = setInterval(() => {
      fetchApprovedReports();
      fetchAlerts();
    }, 15000);

    return () => {
      socket.off("new_emergency_report");
      socket.off("report_status_updated");
      socket.off("new_alert", fetchAlerts);
      socket.off("alert_updated");
      clearInterval(refreshInterval);
    };
  }, []);

  return null;
}
