import { useState, useEffect, useRef } from "react";
import { Search, History, ChevronLeft, ChevronRight } from "lucide-react";

const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? "http://localhost:5000");
const PAGE_SIZE = 20;

const DOMAIN_TABS = [
  { key: "",                 label: "All" },
  { key: "chat",              label: "Chat Moderation" },
  { key: "emergency_report",  label: "Reports" },
  { key: "alert",             label: "Alerts" },
  { key: "evacuation",        label: "Evacuation" },
];

const DOMAIN_BADGE = {
  chat_case:         { label: "Chat Case",  className: "bg-red-100 text-red-700" },
  chat_user:         { label: "Chat User",  className: "bg-orange-100 text-orange-700" },
  emergency_report:  { label: "Report",     className: "bg-blue-100 text-blue-700" },
  alert:             { label: "Alert",      className: "bg-purple-100 text-purple-700" },
  evacuation:        { label: "Evacuation", className: "bg-green-100 text-green-700" },
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` };
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-PH", {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function actionLabel(action) {
  return (action || "").replace(/_/g, " ");
}

export default function AuditLogsPage() {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [domain, setDomain] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const hasLoaded = useRef(false);

  const fetchLogs = async () => {
    try {
      if (!hasLoaded.current) setLoading(true);
      setError("");
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (domain) params.set("domain", domain);
      if (search.trim()) params.set("search", search.trim());

      const res = await fetch(`${API_BASE}/api/audit-logs?${params.toString()}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to load audit logs");
      setEntries(data.entries);
      setTotal(data.total);
    } catch (err) {
      setError(err.message);
    } finally {
      hasLoaded.current = true;
      setLoading(false);
    }
  };

  useEffect(() => {
    const debounce = setTimeout(fetchLogs, search ? 300 : 0);
    return () => clearTimeout(debounce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, domain, search]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl sm:text-3xl font-bold text-gray-900">Audit Logs</h1>
        <p className="text-sm text-gray-500 mt-1">System-wide record of administrative and moderation actions.</p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border-l-4 border-red-600 text-red-700 text-sm px-4 py-3 rounded">{error}</div>
      )}

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by actor, target, or action…"
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-300"
        />
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto">
        {DOMAIN_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setDomain(tab.key); setPage(1); }}
            className={`px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${
              domain === tab.key
                ? "bg-gray-900 text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200 text-gray-500 text-sm">
          <History className="mx-auto mb-2 text-gray-300" size={28} />
          No audit log entries found.
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-3 font-medium">Timestamp</th>
                  <th className="px-4 py-3 font-medium">Domain</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Actor</th>
                  <th className="px-4 py-3 font-medium">Target</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {entries.map((e, i) => {
                  const badge = DOMAIN_BADGE[e.domain] || { label: e.domain, className: "bg-gray-100 text-gray-600" };
                  return (
                    <tr key={i} className="align-top">
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(e.at)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-900 capitalize whitespace-nowrap">{actionLabel(e.action)}</td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{e.actorName || "—"}</td>
                      <td className="px-4 py-3 text-gray-700">{e.target?.label || "—"}</td>
                      <td className="px-4 py-3 text-gray-500">{e.notes || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-3">
            {entries.map((e, i) => {
              const badge = DOMAIN_BADGE[e.domain] || { label: e.domain, className: "bg-gray-100 text-gray-600" };
              return (
                <div key={i} className="bg-white p-4 rounded-xl border border-gray-200">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                    <span className="text-xs text-gray-400">{formatDate(e.at)}</span>
                  </div>
                  <p className="text-sm font-semibold text-gray-900 mt-2 capitalize">{actionLabel(e.action)}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {e.actorName || "—"} · {e.target?.label || "—"}
                  </p>
                  {e.notes && <p className="text-xs text-gray-500 mt-1">{e.notes}</p>}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-4">
            <span className="text-xs text-gray-400">
              {total} entr{total === 1 ? "y" : "ies"}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs font-semibold text-gray-500">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
