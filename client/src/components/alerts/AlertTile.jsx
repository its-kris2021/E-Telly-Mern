import { Clock, MapPin, X } from "lucide-react";
import { SOURCE_CONFIG, RESCUE_CONFIG } from "../../hooks/useAlerts";
import { timeAgo, timeUntil } from "../../utils/timeHelpers";

const SEV_STYLE = {
  evacuate: { badge: "bg-red-600 text-white",         label: "EVACUATE" },
  warning:  { badge: "bg-amber-50 text-amber-700",    label: "Warning"  },
  watch:    { badge: "bg-blue-50 text-blue-700",      label: "Watch"    },
  critical: { badge: "bg-red-50 text-red-800",        label: "Critical" }, // legacy system alerts
};

const SEV_EXPIRY = {
  evacuate: "text-red-500",
  warning:  "text-amber-500",
  watch:    "text-blue-500",
};

export default function AlertTile({ alert, onDismissRequest }) {
  const isRescue = alert.type === "rescue";
  const style    = isRescue ? null : (SEV_STYLE[alert.severity] ?? SEV_STYLE.watch);
  const src      = SOURCE_CONFIG[alert.source] ?? SOURCE_CONFIG.system;
  const until    = !alert.isManual && alert.expiresAt ? timeUntil(alert.expiresAt) : null;

  return (
    <div className={`bg-white rounded-xl border hover:shadow-sm transition-all p-4
      ${isRescue ? "border-red-300 ring-1 ring-red-200" : "border-gray-200 hover:border-gray-300"}`}
    >
      {/* Title + severity badge + dismiss */}
      <div className="flex items-start justify-between gap-2 mb-0.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 leading-snug">{alert.title}</h2>
          {alert.location && (
            <p className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
              <MapPin size={10} className="text-gray-300 flex-shrink-0" />
              <span className="truncate max-w-[200px]">{alert.location}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isRescue ? (
            <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${RESCUE_CONFIG.bg} ${RESCUE_CONFIG.text}`}>
              🚨 RESCUE
            </span>
          ) : (
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${style.badge}`}>
              {style.label}
            </span>
          )}
          <button
            onClick={() => onDismissRequest(alert)}
            className="text-gray-300 hover:text-red-400 transition-colors"
            title="Dismiss alert"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 mt-1.5">
        {alert.description}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between mt-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${src.bg} ${src.text} ${src.border}`}>
            {src.label}
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">
            {alert.type}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-gray-500 font-mono shrink-0">
          <Clock size={10} className="text-gray-300 flex-shrink-0" />
          <span>{timeAgo(alert.updatedAt ?? alert.createdAt)}</span>
          {until && until !== "expired" && (
            <span className={SEV_EXPIRY[alert.severity] ?? "text-gray-400"}>
              · expires {until}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
