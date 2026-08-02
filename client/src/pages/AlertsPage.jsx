import { useState, useCallback } from "react";
import { Plus, RefreshCw, ClipboardList, ChevronDown, ChevronUp, WifiOff } from "lucide-react";
import { useAlerts } from "../hooks/useAlerts";
import { useOfflineAlertQueue } from "../hooks/useOfflineAlertQueue";
import { timeAgo } from "../utils/timeHelpers";
import AlertList from "../components/alerts/AlertList";
import FilterTabs from "../components/alerts/FilterTabs";
import CreateAlertModal from "../components/alerts/CreateAlertModal";
import DismissConfirmModal from "../components/alerts/DismissConfirmModal";

const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? "http://localhost:5000");

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AlertsPage() {
  const { alerts, loading, error, isStale, lastFetched, dismiss, refresh, cooldownSecs, counts } =
    useAlerts();

  const { pendingCount, syncing, enqueue, flush } = useOfflineAlertQueue(refresh);

  const stored = localStorage.getItem("user");
  const isAdmin = stored ? JSON.parse(stored).role === "admin" : false;

  const [showModal,      setShowModal]      = useState(false);
  const [activeFilter,   setActiveFilter]   = useState("all");
  const [pendingDismiss, setPendingDismiss] = useState(null);
  const [logs,           setLogs]           = useState([]);
  const [logsOpen,       setLogsOpen]       = useState(false);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/alerts/log`);
      if (!res.ok) return;
      const data = await res.json();
      setLogs(data.entries ?? []);
    } catch {
      // non-critical
    }
  }, []);

  const filtered =
    activeFilter === "all"     ? alerts :
    activeFilter === "rescue"  ? alerts.filter((a) => a.type === "rescue") :
    alerts.filter((a) => a.type !== "rescue" && a.severity === activeFilter);

  const handleDismissConfirm = () => {
    if (pendingDismiss) {
      dismiss(pendingDismiss._id);
      setPendingDismiss(null);
      fetchLogs();
    }
  };

  const handleCreated = () => {
    refresh();
    fetchLogs();
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
            <p className="text-xs text-gray-400 mt-0.5 font-mono">
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
            <p className="text-xs text-gray-400 font-medium">{s.label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <FilterTabs
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        counts={counts}
      />

      {/* Alert list */}
      <AlertList
        alerts={filtered}
        loading={loading}
        error={error}
        activeFilter={activeFilter}
        onDismissRequest={setPendingDismiss}
        onRetry={refresh}
      />

      {/* Activity log panel — admin only */}
      {isAdmin && <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <button
          onClick={() => {
            if (!logsOpen) fetchLogs();
            setLogsOpen((o) => !o);
          }}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <ClipboardList size={15} className="text-gray-400" />
            Activity Log
            {logs.length > 0 && (
              <span className="bg-gray-100 text-gray-500 text-xs font-medium px-2 py-0.5 rounded-full">
                {logs.length}
              </span>
            )}
          </div>
          {logsOpen
            ? <ChevronUp size={15} className="text-gray-400" />
            : <ChevronDown size={15} className="text-gray-400" />}
        </button>

        {logsOpen && (
          <div className="border-t border-gray-100 divide-y divide-gray-50 max-h-80 overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">
                No activity recorded yet.
              </p>
            ) : (
              logs.map((entry) => (
                <div key={entry._id} className="px-4 py-2.5 flex items-start gap-3">
                  <div className="w-7 h-7 bg-red-50 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-red-500">
                      {(entry.by ?? "?").charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700">
                      <span className="font-semibold">{entry.by}</span>{" "}
                      <span className="text-gray-500">
                        {entry.action === "created" ? "created" : "dismissed"}
                      </span>{" "}
                      <span className="text-gray-600 italic truncate">
                        "{entry.alertTitle}"
                      </span>
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {fmtTime(entry.at)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>}

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
