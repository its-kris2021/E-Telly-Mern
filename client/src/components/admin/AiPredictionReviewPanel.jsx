// Dedicated "pending AI predictions" review list — fixes the gap found in
// the Oct-19 precision audit: the only way to confirm/reject an AI alert was
// to find its exact marker in a map popup before it auto-expired in 6h, which
// is why 22/22 AI alerts all-time had expired unreviewed (0 admin actions).
// This surfaces the same pending alerts as a plain list on the Alerts page,
// reachable without the map at all. Reuses the same PATCH endpoints the map
// popup already calls (see components/map/predictions/AiPredictionLayer.jsx).
import { useState } from "react";
import { Sparkles, Check, X } from "lucide-react";
import { timeAgo, timeUntil } from "../../utils/timeHelpers";

const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? `http://${window.location.hostname}:5000`);

const SEVERITY_COLOR = {
  watch: "text-blue-600 bg-blue-50 border-blue-200",
  warning: "text-amber-700 bg-amber-50 border-amber-200",
  critical: "text-red-700 bg-red-50 border-red-200",
  evacuate: "text-red-700 bg-red-50 border-red-200",
};

function PendingAiTile({ alert, onAction, busy }) {
  const confidencePct = alert.confidence != null ? Math.round(alert.confidence * 100) : null;
  const sevClass = SEVERITY_COLOR[alert.severity] ?? SEVERITY_COLOR.watch;
  const expiry = alert.expiresAt ? timeUntil(alert.expiresAt) : null;

  return (
    <div className="border border-gray-100 rounded-lg p-3 bg-violet-50/30">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-800 leading-snug">{alert.title}</p>
          <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{alert.description}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap mt-2">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${sevClass}`}>
          {alert.severity}
        </span>
        {confidencePct != null && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
            {confidencePct}% confidence
          </span>
        )}
        <span className="text-[10px] text-gray-400">{timeAgo(alert.createdAt)}</span>
        {expiry && expiry !== "expired" && (
          <span className="text-[10px] text-amber-600">expires {expiry}</span>
        )}
      </div>
      <div className="flex gap-2 mt-2.5">
        <button
          disabled={busy}
          onClick={() => onAction(alert._id, "confirm")}
          className="flex-1 flex items-center justify-center gap-1 bg-green-600 disabled:opacity-50
                     text-white text-[11px] font-semibold rounded-md py-1.5 hover:bg-green-700 transition-colors"
        >
          <Check size={12} /> Confirm — hazard occurred
        </button>
        <button
          disabled={busy}
          onClick={() => onAction(alert._id, "reject")}
          className="flex-1 flex items-center justify-center gap-1 bg-gray-100 disabled:opacity-50
                     text-gray-700 text-[11px] font-semibold rounded-md py-1.5 hover:bg-gray-200 transition-colors"
        >
          <X size={12} /> Mark false positive
        </button>
      </div>
    </div>
  );
}

// `alerts` is the SAME array useAlerts() already fetched for the main alert
// feed (already scoped to the viewer's barangay for barangay_official, and
// already kept live via the "alert_updated" socket listener in useAlerts) —
// deliberately not a second fetch, so this list and the main feed can never
// disagree about what's currently active.
export default function AiPredictionReviewPanel({ alerts }) {
  const [busyId, setBusyId] = useState(null);

  const pending = (alerts ?? []).filter(
    (a) => a.source === "ai" && (a.confirmedOutcome ?? "unconfirmed") === "unconfirmed",
  );

  const handleAction = async (id, action) => {
    setBusyId(id);
    try {
      await fetch(`${API_BASE}/api/alerts/${id}/${action}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` },
      });
      // No local state mutation here — the server emits "alert_updated" on
      // success, which useAlerts() is already subscribed to and will refetch,
      // removing this tile once confirmedOutcome actually changes.
    } catch (err) {
      console.warn(`[AiPredictionReviewPanel] ${action} failed:`, err.message);
    } finally {
      setBusyId(null);
    }
  };

  if (pending.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-violet-200 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-violet-100 bg-violet-50/50">
        <Sparkles size={15} className="text-violet-500" />
        <span className="text-sm font-semibold text-gray-700">AI Predictions Pending Review</span>
        <span className="text-[11px] font-bold text-violet-600 bg-violet-100 px-2 py-0.5 rounded-full">
          {pending.length}
        </span>
      </div>
      <div className="p-3 space-y-2">
        {pending.map((alert) => (
          <PendingAiTile
            key={alert._id}
            alert={alert}
            busy={busyId === alert._id}
            onAction={handleAction}
          />
        ))}
      </div>
    </div>
  );
}
