import { useEffect, useState } from "react";
import { Waves, X, MapPin, TriangleAlert, Siren, WifiOff } from "lucide-react";
import { useOfflineCache } from "../../../hooks/useOfflineCache";
import { connectSocket } from "../../../utils/socket";

const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? `http://${window.location.hostname}:5000`);

const SEVERITY_ORDER = { evacuate: 0, critical: 1, warning: 2, watch: 3 };

const HEADER_STYLE = {
  normal: {
    bg: "bg-white", border: "border-gray-200", text: "text-gray-600",
    label: "Flood Monitor", sub: "Open-Meteo forecast · PAGASA thresholds",
    icon: <Waves className="w-4 h-4 text-blue-400" />,
    btn: "bg-white border-gray-300", wave: "text-blue-400",
  },
  watch: {
    bg: "bg-blue-50", border: "border-blue-300", text: "text-blue-700",
    label: "Flood Watch", sub: "Open-Meteo forecast · PAGASA thresholds",
    icon: <Waves className="w-4 h-4 text-blue-500" />,
    btn: "bg-blue-50 border-blue-300", wave: "text-blue-500",
  },
  warning: {
    bg: "bg-amber-50", border: "border-amber-300", text: "text-amber-700",
    label: "Flood Warning", sub: "Open-Meteo forecast · PAGASA thresholds",
    icon: <TriangleAlert className="w-4 h-4 text-amber-500" />,
    btn: "bg-amber-50 border-amber-400", wave: "text-amber-500",
  },
  critical: {
    bg: "bg-red-50", border: "border-red-400", text: "text-red-700",
    label: "High Flood Risk", sub: "Open-Meteo forecast · PAGASA thresholds",
    icon: <Siren className="w-4 h-4 text-red-500" />,
    btn: "bg-red-50 border-red-400", wave: "text-red-500",
  },
  evacuate: {
    bg: "bg-red-100", border: "border-red-500", text: "text-red-800",
    label: "EVACUATE", sub: "Open-Meteo forecast · PAGASA thresholds",
    icon: <Siren className="w-4 h-4 text-red-700" />,
    btn: "bg-red-100 border-red-500", wave: "text-red-600",
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
  system:    { label: "Open-Meteo · PAGASA", cls: "bg-blue-50 text-blue-600 border-blue-200"     },
  residents: { label: "Resident Report",      cls: "bg-orange-50 text-orange-600 border-orange-200" },
  CDRRMO:    { label: "CDRRMO Advisory",      cls: "bg-red-50 text-red-600 border-red-200"       },
  Barangay:  { label: "Barangay Advisory",    cls: "bg-green-50 text-green-600 border-green-200" },
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

const timeAgo = (ts) => {
  if (!ts) return "";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
};


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

const FloodForecastPanel = ({
  visible,
  isOpen,
  onToggle,
  topStyle = null,
  topPosition = "top-[170px]",
  onOfflineChange,
  onFlyTo,
}) => {
  const { data: forecastData, isOffline, cachedAt } = useOfflineCache(
    "flood-forecast",
    () => fetch("/api/hazard/flood-forecast").then((r) => r.json()),
    10 * 60 * 1000,
  );

  const [allAlerts, setAllAlerts]         = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [refreshKey, setRefreshKey]       = useState(0);

  useEffect(() => {
    if (typeof onOfflineChange === "function") onOfflineChange({ isOffline, cachedAt });
  }, [isOffline, cachedAt, onOfflineChange]);

  // Refresh immediately when an alert is dismissed/created anywhere in the app
  useEffect(() => {
    const socket = connectSocket();
    const bump = () => setRefreshKey((n) => n + 1);
    socket.on("alert_updated", bump);
    socket.on("new_alert",     bump);
    return () => {
      socket.off("alert_updated", bump);
      socket.off("new_alert",     bump);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const load = async () => {
      setAlertsLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/alerts`);
        if (!res.ok) throw new Error("fetch failed");
        const { alerts = [] } = await res.json();
        const flood = alerts
          .filter((a) => a.type === "flood" && a.isActive)
          .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99));
        if (!cancelled) setAllAlerts(flood);
      } catch {
        // silent — show last loaded list
      } finally {
        if (!cancelled) setAlertsLoading(false);
      }
    };

    load();
    const interval = setInterval(load, 2 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isOpen, refreshKey]);

  if (!visible) return null;

  const overallSev = getOverallSeverity(allAlerts);
  const h          = HEADER_STYLE[overallSev] ?? HEADER_STYLE.normal;
  const hasAlerts  = allAlerts.length > 0;

  const updatedAt = forecastData?.generatedAt
    ? new Date(forecastData.generatedAt).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <>
      <button
        onClick={onToggle}
        title="Flood Risk Monitor"
        style={topStyle ?? undefined}
        className={`absolute ${topStyle ? "" : topPosition} left-[10px] z-[1000]
                    w-[30px] h-[30px] border flex items-center justify-center
                    shadow-sm hover:brightness-95 transition-all ${h.btn}
                    ${isOpen ? "ring-1 ring-offset-1 ring-current" : ""}`}
      >
        <Waves size={15} strokeWidth={1.8} className={h.wave} />
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
                <div className="flex items-center gap-1.5">
                  <p className={`text-xs font-bold ${h.text}`}>{h.label}</p>
                  {isOffline && (
                    <WifiOff size={10} className="text-amber-500" title={`Cached ${timeAgo(cachedAt)}`} />
                  )}
                </div>
                <p className="text-[10px] text-gray-400">
                  {h.sub}
                  {isOffline && cachedAt && (
                    <span className="text-amber-500 ml-1">· cached {timeAgo(cachedAt)}</span>
                  )}
                </p>
              </div>
            </div>
            <button onClick={onToggle} className="text-gray-300 hover:text-gray-500 transition-colors">
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2 mb-10">
            {alertsLoading && !hasAlerts ? (
              <div className="py-6 flex items-center justify-center gap-2">
                <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
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
                  System alerts: Open-Meteo · PAGASA advisory thresholds
                </p>
              </>
            ) : (
              <div className="py-6 flex flex-col items-center gap-2 text-center">
                <Waves size={22} className="text-gray-200" />
                <p className="text-xs font-semibold text-gray-400">No active flood alerts</p>
                <p className="text-[10px] text-gray-300 leading-snug max-w-[180px]">
                  An advisory will appear here when rainfall forecast exceeds PAGASA warning thresholds.
                </p>
              </div>
            )}

          </div>

          {/* Footer */}
          <div className="flex-shrink-0 border-t border-gray-100 px-4 py-2.5 flex flex-col gap-0.5 rounded-b-2xl">
            <p className="text-[9px] text-gray-400 font-medium">System flood prediction</p>
            <p className="text-[9px] text-gray-300 leading-tight">
              updated every 15 min
              {updatedAt && !isOffline && <span className="ml-1">· last run {updatedAt}</span>}
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default FloodForecastPanel;
