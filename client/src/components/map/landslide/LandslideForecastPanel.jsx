import { useEffect } from "react";
import { Mountain, MapPin, TriangleAlert, Siren, X } from "lucide-react";
import { connectSocket } from "../../../utils/socket";
import { useOfflineCache } from "../../../hooks/useOfflineCache";

const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? "http://localhost:5000");

const fetchLandslideAlerts = () =>
  fetch(`${API_BASE}/api/alerts`)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(({ alerts = [] }) =>
      alerts
        .filter((a) => a.type === "landslide" && a.isActive)
        .sort(
          (a, b) =>
            (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99),
        ),
    );

const fetchRainfall = () =>
  fetch("/api/hazard/rainfall-hourly")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });

const SEVERITY_ORDER = { evacuate: 0, critical: 1, warning: 2, watch: 3 };

const HEADER_STYLE = {
  normal: {
    bg: "bg-white", border: "border-gray-200", text: "text-gray-600",
    label: "Landslide Monitor", sub: "Open-Meteo · PAGASA/MGB thresholds",
    icon: <Mountain className="w-4 h-4 text-amber-400" />,
    btn: "bg-white border-gray-300", iconColor: "text-amber-400",
  },
  watch: {
    bg: "bg-blue-50", border: "border-blue-300", text: "text-blue-700",
    label: "Landslide Watch", sub: "Open-Meteo · PAGASA/MGB thresholds",
    icon: <Mountain className="w-4 h-4 text-blue-500" />,
    btn: "bg-blue-50 border-blue-300", iconColor: "text-blue-500",
  },
  warning: {
    bg: "bg-amber-50", border: "border-amber-300", text: "text-amber-700",
    label: "Landslide Warning", sub: "Open-Meteo · PAGASA/MGB thresholds",
    icon: <TriangleAlert className="w-4 h-4 text-amber-500" />,
    btn: "bg-amber-50 border-amber-400", iconColor: "text-amber-500",
  },
  critical: {
    bg: "bg-red-50", border: "border-red-400", text: "text-red-700",
    label: "High Landslide Risk", sub: "Open-Meteo · PAGASA/MGB thresholds",
    icon: <Siren className="w-4 h-4 text-red-500" />,
    btn: "bg-red-50 border-red-400", iconColor: "text-red-500",
  },
  evacuate: {
    bg: "bg-red-100", border: "border-red-500", text: "text-red-800",
    label: "EVACUATE", sub: "Open-Meteo · PAGASA/MGB thresholds",
    icon: <Siren className="w-4 h-4 text-red-700" />,
    btn: "bg-red-100 border-red-500", iconColor: "text-red-600",
  },
};

const SEVERITY_BADGE = {
  evacuate: {
    bg: "bg-red-600", text: "text-white", label: "EVACUATE",
    dot: "bg-red-600", cardBorder: "border-red-200", cardBg: "bg-red-50",
    nameCls: "text-red-800", descCls: "text-red-600", pulse: true,
  },
  critical: {
    bg: "bg-red-100", text: "text-red-800", label: "CRITICAL",
    dot: "bg-red-500", cardBorder: "border-red-200", cardBg: "bg-red-50",
    nameCls: "text-red-800", descCls: "text-red-600", pulse: true,
  },
  warning: {
    bg: "bg-amber-100", text: "text-amber-800", label: "WARNING",
    dot: "bg-amber-500", cardBorder: "border-amber-200", cardBg: "bg-amber-50",
    nameCls: "text-amber-800", descCls: "text-amber-700", pulse: false,
  },
  watch: {
    bg: "bg-blue-100", text: "text-blue-800", label: "WATCH",
    dot: "bg-blue-500", cardBorder: "border-blue-200", cardBg: "bg-blue-50",
    nameCls: "text-blue-800", descCls: "text-blue-700", pulse: false,
  },
};

const SOURCE_INFO = {
  system:    { label: "Open-Meteo · PAGASA/MGB", cls: "bg-blue-50 text-blue-600 border-blue-200"     },
  residents: { label: "Resident Report",          cls: "bg-orange-50 text-orange-600 border-orange-200" },
  CDRRMO:    { label: "CDRRMO Advisory",          cls: "bg-red-50 text-red-600 border-red-200"       },
  Barangay:  { label: "Barangay Advisory",        cls: "bg-green-50 text-green-600 border-green-200" },
};

function getOverallSeverity(alerts) {
  if (!alerts.length) return "normal";
  return alerts.reduce((worst, a) =>
    (SEVERITY_ORDER[a.severity] ?? 99) < (SEVERITY_ORDER[worst.severity] ?? 99) ? a : worst
  ).severity;
}

function getLocationName(alert) {
  if (alert.barangays?.length > 0) return alert.barangays.join(", ");
  const loc = alert.location ?? "";
  if (/^-?\d+\.?\d*,-?\d+\.?\d*$/.test(loc.trim())) return "Antipolo City";
  return loc || "Antipolo City";
}

function getLocationChip(alert) {
  if (!alert.barangays?.length && alert.source === "system") return "City-wide";
  if (alert.barangays?.length > 1) return `${alert.barangays.length} zones`;
  return null;
}

function extractReason(description) {
  const clean = description.replace(/\s*Source:.*$/s, "").trim();
  return clean.length > 180 ? clean.slice(0, 177) + "…" : clean;
}

function getAlertCoords(alert) {
  if (alert.lat && alert.lng) return [alert.lat, alert.lng];
  const loc = alert.location ?? "";
  const m = loc.match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/);
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
}

const alertTimeAgo = (ts) => {
  if (!ts) return null;
  const ms = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const AlertCard = ({ alert, onFlyTo }) => {
  const s   = SEVERITY_BADGE[alert.severity] ?? SEVERITY_BADGE.watch;
  const src = SOURCE_INFO[alert.source] ?? { label: alert.source ?? "Advisory", cls: "bg-gray-50 text-gray-500 border-gray-200" };
  const locationName = getLocationName(alert);
  const locationChip = getLocationChip(alert);
  const coords = getAlertCoords(alert);
  const issuedAgo = alertTimeAgo(alert.createdAt);

  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${s.cardBg} ${s.cardBorder} ${coords && onFlyTo ? "cursor-pointer hover:brightness-95 transition-all" : ""}`}
      onClick={() => coords && onFlyTo?.(coords[0], coords[1])}
      title={coords && onFlyTo ? "Click to fly to this alert on the map" : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot} ${s.pulse ? "animate-pulse" : ""}`} />
          <span className={`text-[11px] font-bold truncate ${s.nameCls}`}>{locationName}</span>
          {locationChip && (
            <span className="text-[9px] text-gray-400 flex-shrink-0">{locationChip}</span>
          )}
        </div>
        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${s.bg} ${s.text}`}>
          {s.label}
        </span>
      </div>
      <span className={`inline-block mt-1.5 text-[8px] font-semibold px-1.5 py-0.5 rounded border ${src.cls}`}>
        {src.label}
      </span>
      <p className={`text-[9px] leading-snug mt-1 ${s.descCls}`}>
        {extractReason(alert.description)}
      </p>
      {issuedAgo && (
        <p className="text-[8px] text-gray-400 mt-1.5 pt-1 border-t border-gray-100">
          Issued {issuedAgo}
        </p>
      )}
    </div>
  );
};

// ── Hooks always called unconditionally (Rules of Hooks) ─────────────────────
const LandslideForecastPanelContent = ({ isOpen, onToggle, topStyle, onFlyTo, onOfflineChange }) => {
  const {
    data,
    loading: alertsLoading,
    isOffline,
    cachedAt,
    refresh,
  } = useOfflineCache("landslide-alerts", fetchLandslideAlerts, 2 * 60 * 1000);

  const { data: rainfallData } = useOfflineCache(
    "rainfall-hourly",
    fetchRainfall,
    10 * 60 * 1000,
  );

  const allAlerts = data ?? [];

  useEffect(() => {
    const socket = connectSocket();
    const bump = () => refresh({ background: true });
    socket.on("alert_updated", bump);
    socket.on("new_alert",     bump);
    return () => {
      socket.off("alert_updated", bump);
      socket.off("new_alert",     bump);
    };
  }, [refresh]);

  useEffect(() => {
    if (typeof onOfflineChange === "function") {
      onOfflineChange({ isOffline, cachedAt });
    }
  }, [isOffline, cachedAt, onOfflineChange]);

  const overallSev = getOverallSeverity(allAlerts);
  const h          = HEADER_STYLE[overallSev] ?? HEADER_STYLE.normal;
  const hasAlerts  = allAlerts.length > 0;

  return (
    <>
      <button
        onClick={onToggle}
        title="Landslide Risk"
        style={topStyle ?? undefined}
        className={`absolute left-[10px] z-[1000]
                    w-[30px] h-[30px] border flex items-center justify-center
                    shadow-sm hover:brightness-95 transition-all ${h.btn}
                    ${isOpen ? "ring-1 ring-offset-1 ring-current" : ""}`}
      >
        <Mountain size={15} strokeWidth={1.8} className={h.iconColor} />
      </button>

      {isOpen && (
        <div
          className={`absolute top-[90px] left-[50px] z-[1050] bg-white border rounded-2xl shadow-xl flex flex-col ${h.border}`}
          style={{ width: "272px", maxHeight: "calc(100vh - 120px)" }}
        >
          {/* Header */}
          <div className={`flex items-center justify-between px-4 py-3 ${h.bg} border-b ${h.border} flex-shrink-0 rounded-t-2xl`}>
            <div className="flex items-center gap-2">
              {h.icon}
              <div>
                <p className={`text-xs font-bold ${h.text}`}>{h.label}</p>
                <p className="text-[10px] text-gray-400">{h.sub}</p>
              </div>
            </div>
            <button onClick={onToggle} className="text-gray-300 hover:text-gray-500 transition-colors">
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto flex flex-col">
            <div className="px-4 py-3 flex flex-col gap-2">

              {/* Rainfall context — shows current & 6h peak so CDRRMO understands why an alert fired */}
              {rainfallData?.hours?.length > 0 && (() => {
                const current = rainfallData.hours[0];
                const peak    = rainfallData.hours.slice(0, 6).reduce((mx, h) =>
                  h.precipitation > mx.precipitation ? h : mx
                );
                const levelColor = (lvl) =>
                  lvl >= 3 ? "text-red-600" : lvl >= 2 ? "text-amber-600" : lvl >= 1 ? "text-blue-600" : "text-gray-400";
                return (
                  <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5">
                    <p className="text-[9px] font-bold text-amber-700 uppercase tracking-wide mb-1.5">
                      Current Rainfall
                    </p>
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-gray-500">Now</span>
                        <span className={`font-semibold ${levelColor(current.pagasa?.level ?? 0)}`}>
                          {current.precipitation > 0 ? `${current.precipitation.toFixed(1)} mm/hr` : "0 mm/hr"} · {current.pagasa?.label ?? "None"}
                        </span>
                      </div>
                      {peak.precipitation > current.precipitation && peak.precipitation > 0 && (
                        <div className="flex justify-between text-[10px]">
                          <span className="text-gray-500">6h peak</span>
                          <span className={`font-semibold ${levelColor(peak.pagasa?.level ?? 0)}`}>
                            {peak.precipitation.toFixed(1)} mm/hr · {peak.pagasa?.label ?? "None"}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {alertsLoading && !hasAlerts ? (
                <div className="py-4 flex items-center justify-center gap-2">
                  <div className="w-3 h-3 border border-amber-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-gray-400">Checking alerts…</span>
                </div>
              ) : hasAlerts ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <MapPin size={10} className="text-gray-400 flex-shrink-0" />
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">
                      Active Advisories
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {allAlerts.map((alert) => (
                      <AlertCard key={alert._id} alert={alert} onFlyTo={onFlyTo} />
                    ))}
                  </div>
                  <p className="text-[8px] text-gray-300 leading-tight">
                    System alerts: Open-Meteo · PAGASA advisory · MGB thresholds
                  </p>
                </>
              ) : (
                <div className="py-6 flex flex-col items-center gap-2 text-center">
                  <Mountain size={22} className="text-gray-200" />
                  <p className="text-xs font-semibold text-gray-400">No active landslide alerts</p>
                  <p className="text-[10px] text-gray-300 leading-snug max-w-[180px]">
                    An advisory will appear here when rainfall forecast exceeds PAGASA and MGB warning thresholds.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 border-t border-gray-100 px-4 py-2.5 rounded-b-2xl">
            <p className="text-[9px] text-gray-400 font-medium">System landslide prediction</p>
            <p className="text-[9px] text-gray-300">updated every 15 min</p>
          </div>
        </div>
      )}
    </>
  );
};

const LandslideForecastPanel = (props) => {
  if (!props.visible) return null;
  return <LandslideForecastPanelContent {...props} />;
};

export default LandslideForecastPanel;
