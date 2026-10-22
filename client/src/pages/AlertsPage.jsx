import { useState } from "react";
import { Plus, RefreshCw, WifiOff } from "lucide-react";
import { useAlerts } from "../hooks/useAlerts";
import { useOfflineAlertQueue } from "../hooks/useOfflineAlertQueue";
import { timeAgo } from "../utils/timeHelpers";
import AlertList from "../components/alerts/AlertList";
import FilterTabs from "../components/alerts/FilterTabs";
import CreateAlertModal from "../components/alerts/CreateAlertModal";
import DismissConfirmModal from "../components/alerts/DismissConfirmModal";
import AiPredictionReviewPanel from "../components/admin/AiPredictionReviewPanel";
import { getUserRole } from "../config/roleModules";

export default function AlertsPage() {
  const { alerts, loading, error, isStale, lastFetched, dismiss, refresh, cooldownSecs, counts } =
    useAlerts();

  const { pendingCount, syncing, enqueue, flush } = useOfflineAlertQueue(refresh);

  // AI prediction review is NOT cdrrmo-only — the server's confirm/reject
  // routes allow "cdrrmo" or "barangay_official" (routes/alerts.js), since a
  // barangay official is the one who'd actually know if a predicted flood/
  // landslide in their own barangay happened or not.
  const canReviewAi = ["cdrrmo", "barangay_official"].includes(getUserRole());

  const [showModal,      setShowModal]      = useState(false);
  const [activeFilter,   setActiveFilter]   = useState("all");
  const [pendingDismiss, setPendingDismiss] = useState(null);

  // Pending (unconfirmed) AI predictions now live in their own review panel
  // above, with Confirm/Reject actions — excluded here so they don't also
  // show in the generic feed with just a plain Dismiss button, which
  // wouldn't record any confirmedOutcome at all.
  const visibleAlerts = alerts.filter(
    (a) => !(a.source === "ai" && (a.confirmedOutcome ?? "unconfirmed") === "unconfirmed"),
  );
  const filtered =
    activeFilter === "all"     ? visibleAlerts :
    activeFilter === "rescue"  ? visibleAlerts.filter((a) => a.type === "rescue") :
    visibleAlerts.filter((a) => a.type !== "rescue" && a.severity === activeFilter);

  const handleDismissConfirm = () => {
    if (pendingDismiss) {
      dismiss(pendingDismiss._id);
      setPendingDismiss(null);
    }
  };

  const handleCreated = () => {
    refresh();
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Alerts</h1>
          <p className="text-sm text-gray-500 mt-1">
            Antipolo City — Hazard &amp; Evacuation Operations
          </p>
          {lastFetched && (
            <p className="text-xs text-gray-500 mt-0.5 font-mono">
              Last updated at{" "}
              {new Date(lastFetched).toLocaleTimeString("en-PH", {
                timeZone: "Asia/Manila",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {isStale
                ? <span className="text-amber-500 font-semibold"> · offline</span>
                : ` · ${timeAgo(lastFetched)}`}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={cooldownSecs > 0 ? undefined : refresh}
            disabled={cooldownSecs > 0}
            title={cooldownSecs > 0 ? `Refresh in ${cooldownSecs}s` : "Refresh alerts"}
            className={`w-9 h-9 rounded-lg border border-gray-200 flex items-center justify-center
                        transition-colors
                        ${cooldownSecs > 0
                          ? "text-gray-300 cursor-not-allowed"
                          : "text-gray-400 hover:bg-gray-50 hover:text-gray-700"}`}
          >
            <RefreshCw size={14} className={loading && cooldownSecs === 0 ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg
                       hover:bg-red-700 active:bg-red-800 transition-colors flex items-center gap-1.5"
          >
            <Plus size={14} />
            New Alert
          </button>
        </div>
      </div>

      {/* Offline sync banner */}
      {pendingCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <WifiOff size={14} className="shrink-0" />
          <span className="flex-1">
            {syncing
              ? "Syncing queued alerts…"
              : `${pendingCount} alert${pendingCount > 1 ? "s" : ""} saved offline — will sync automatically when connected`}
          </span>
          {!syncing && navigator.onLine && (
            <button
              onClick={flush}
              className="text-xs font-semibold text-amber-700 hover:underline shrink-0"
            >
              Sync now
            </button>
          )}
        </div>
      )}

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Active Alerts",
            value: counts.total,
            color: "text-gray-900",
            sub: "currently active",
          },
          {
            label: "Rescue Needed",
            value: counts.rescue ?? 0,
            color: "text-red-600",
            sub: "life-threatening",
          },
          {
            label: "Immediate Action",
            value: (counts.evacuate ?? 0) + (counts.critical ?? 0),
            color: "text-orange-600",
            sub: "evacuate + critical",
          },
          {
            label: "Monitoring",
            value: (counts.warning ?? 0) + (counts.watch ?? 0),
            color: "text-blue-600",
            sub: "warning + watch",
          },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <p className="text-xs text-gray-500 font-medium">{s.label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <FilterTabs
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        counts={counts}
      />

      {/* AI predictions awaiting confirm/reject — cdrrmo + barangay_official */}
      {canReviewAi && <AiPredictionReviewPanel alerts={alerts} />}

      {/* Alert list */}
      <AlertList
        alerts={filtered}
        loading={loading}
        error={error}
        activeFilter={activeFilter}
        onDismissRequest={setPendingDismiss}
        onRetry={refresh}
      />


      {/* Create Alert Modal */}
      {showModal && (
        <CreateAlertModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
          enqueue={enqueue}
        />
      )}

      {/* Dismiss Confirmation Modal */}
      {pendingDismiss && (
        <DismissConfirmModal
          alert={pendingDismiss}
          onConfirm={handleDismissConfirm}
          onCancel={() => setPendingDismiss(null)}
        />
      )}
    </div>
  );
}
