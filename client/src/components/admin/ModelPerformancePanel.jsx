// Shows the AI risk model's version history and real-world outcome counts —
// how scripts/trainRiskModel.js's predictions have actually done in the
// field (admin confirm/reject + auto-linked reports), not just offline
// cross-validation. Lets the team show the model calibrating/improving over
// time rather than claiming a fixed accuracy number.
import { useState, useEffect, useCallback } from "react";
import { ChevronDown, ChevronUp, Sparkles, RefreshCw } from "lucide-react";

const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? "http://localhost:5000");

function fmtPct(v) {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-PH", {
    timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function OutcomeBar({ truePositives, falsePositives, unconfirmed }) {
  const total = truePositives + falsePositives + unconfirmed;
  if (total === 0) {
    return <div className="h-2 rounded-full bg-gray-100" />;
  }
  const pct = (n) => `${(n / total) * 100}%`;
  return (
    <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
      {truePositives > 0 && <div style={{ width: pct(truePositives) }} className="bg-green-500 rounded-full" />}
      {falsePositives > 0 && <div style={{ width: pct(falsePositives) }} className="bg-gray-400 rounded-full" />}
      {unconfirmed > 0 && <div style={{ width: pct(unconfirmed) }} className="bg-violet-200 rounded-full" />}
    </div>
  );
}

function StatTile({ label, value }) {
  return (
    <div className="bg-gray-50 rounded-lg px-2.5 py-2">
      <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide">{label}</p>
      <p className="text-sm font-bold text-gray-800 mt-0.5">{value}</p>
    </div>
  );
}

function HazardSection({ hazardType, data }) {
  const versions = data?.versions ?? [];
  const active = versions.find((v) => v.isActive) ?? versions[0];
  const outcomes = data?.currentOutcomes ?? { truePositives: 0, falsePositives: 0, unconfirmed: 0 };

  return (
    <div className="border border-gray-100 rounded-xl p-3">
      <p className="text-xs font-bold text-gray-700 capitalize mb-2">{hazardType} model</p>

      {!active ? (
        <p className="text-xs text-gray-400">Not trained yet — run `node scripts/trainRiskModel.js`.</p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            <StatTile label="Version" value={`v${active.version}`} />
            <StatTile label="Precision" value={fmtPct(active.metrics?.precision)} />
            <StatTile label="Recall" value={fmtPct(active.metrics?.recall)} />
            <StatTile label="AUC" value={active.metrics?.auc == null ? "—" : active.metrics.auc.toFixed(2)} />
          </div>

          <p className="text-[10px] text-gray-400 mb-1">
            Trained on {active.trainingSetSize} labeled day(s), {active.positiveCount} positive · {fmtDate(active.trainedAt)}
          </p>
          {active.notes && <p className="text-[10px] text-amber-600 mb-2">{active.notes}</p>}

          <p className="text-[10px] font-semibold text-gray-500 mt-2 mb-1">Field outcomes (all-time)</p>
          <OutcomeBar {...outcomes} />
          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" />Confirmed ({outcomes.truePositives})</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-400" />False positive ({outcomes.falsePositives})</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-200" />Unconfirmed ({outcomes.unconfirmed})</span>
          </div>

          {versions.length > 1 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-gray-400 text-left">
                    <th className="font-medium pb-1">Ver</th>
                    <th className="font-medium pb-1">Trained</th>
                    <th className="font-medium pb-1">Rows</th>
                    <th className="font-medium pb-1">Precision</th>
                    <th className="font-medium pb-1">Recall</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v._id} className="border-t border-gray-50 text-gray-600">
                      <td className="py-1">v{v.version}{v.isActive ? " ●" : ""}</td>
                      <td className="py-1">{fmtDate(v.trainedAt)}</td>
                      <td className="py-1">{v.trainingSetSize}</td>
                      <td className="py-1">{fmtPct(v.metrics?.precision)}</td>
                      <td className="py-1">{fmtPct(v.metrics?.recall)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ModelPerformancePanel() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("token") ?? "";
      const res = await fetch(`${API_BASE}/api/admin/model-metrics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Request failed");
      setData(await res.json());
    } catch {
      setError("Failed to load model metrics.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !data) fetchMetrics();
  }, [open, data, fetchMetrics]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Sparkles size={15} className="text-violet-400" />
          AI Model Performance
        </div>
        {open ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 p-3 space-y-3">
          {loading && <p className="text-xs text-gray-400 text-center py-3">Loading…</p>}
          {error && (
            <div className="flex items-center justify-between text-xs text-red-500">
              {error}
              <button onClick={fetchMetrics} className="flex items-center gap-1 text-gray-500 hover:text-gray-700">
                <RefreshCw size={11} /> Retry
              </button>
            </div>
          )}
          {data && (
            <>
              <HazardSection hazardType="flood" data={data.flood} />
              <HazardSection hazardType="landslide" data={data.landslide} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
