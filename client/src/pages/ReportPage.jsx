import ReportTile from "../components/admin/ReportTile";
import { useState, useEffect, useRef } from "react";
import { connectSocket } from "../utils/socket";
import { TrendingUp, Search, Download, Siren } from "lucide-react";
import { barangayLabel } from "../config/barangays";

const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? "http://localhost:5000");
const IS_LOCAL_MODE = import.meta.env?.VITE_LOCAL_MODE === "true";

const TABS = [
  { key: "pending",  label: "Pending" },
  { key: "ongoing",  label: "Ongoing" },
  { key: "resolved", label: "Resolved" },
  { key: "rejected", label: "Rejected" },
];

const getCurrentUser = () => {
  try {
    const stored = localStorage.getItem("user");
    if (!stored) return "admin";
    const u = JSON.parse(stored);
    return u.name || u.email || "admin";
  } catch {
    return "admin";
  }
};

export default function ReportsPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("ongoing");
  const [search, setSearch] = useState("");
  const [rescueOnly, setRescueOnly] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const hasLoaded = useRef(false);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchSyncStatus = async () => {
    if (!IS_LOCAL_MODE) return;
    try {
      const res = await fetch(`${API_BASE}/api/sync/status`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` },
      });
      if (res.ok) setSyncStatus(await res.json());
    } catch {}
  };

  const handleExport = () => {
    window.open(`${API_BASE}/api/sync/export`, "_blank");
  };

  useEffect(() => {
    fetchReports();
    fetchSyncStatus();

    const socket = connectSocket();
    socket.on("new_emergency_report", () => { fetchReports(); fetchSyncStatus(); });
    socket.on("report_updated", () => fetchReports());

    // Fallback poll — catches updates if the socket event is missed
    const poll = setInterval(fetchReports, 30_000);
    const syncPoll = IS_LOCAL_MODE ? setInterval(fetchSyncStatus, 30_000) : null;

    return () => {
      socket.off("new_emergency_report");
      socket.off("report_updated");
      clearInterval(poll);
      if (syncPoll) clearInterval(syncPoll);
    };
  }, []);

  const fetchReports = async () => {
    try {
      if (!hasLoaded.current) setLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE}/api/reports`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` },
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();

      if (data.success && data.reports) {
        const seen = new Set();
        const formattedReports = data.reports
          .filter((report) => {
            const id = String(report._id || report.id || "");
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          })
          .map((report) => ({
            id: String(report._id || report.id || ""),
            type:
              report.emergencyType?.charAt(0).toUpperCase() +
              report.emergencyType?.slice(1),
            severity: report.severity?.toLowerCase(),
            rescue: ["rescue", "sos"].includes(report.emergencyType?.toLowerCase()),
            description: report.description || "No description provided",
            location:
              report.location?.exactAddress ||
              report.location ||
              "Unknown location",
            // Reporter's registered profile barangay — not the GPS/incident
            // location above. Null when the report isn't linked to a
            // registered resident (e.g. anonymous submission).
            barangay: report.reporterBarangayKey ? barangayLabel(report.reporterBarangayKey) : null,
            timestamp: report.timestamp ? new Date(report.timestamp).toLocaleString() : "",
            rawTimestamp: report.timestamp,
            reportedBy:
              report.userData?.fullName || report.userName || "Anonymous",
            hasImage: report.images?.length > 0,
            imageUrl: report.images?.[0] || null,
            status: report.status || "pending",
            source: report.source || "online",
            adminNotes: report.adminNotes || null,
            resolvedBy: report.resolvedBy || null,
            resolvedAt: report.resolvedAt || null,
            resolutionNotes: report.resolutionNotes || null,
            logs: report.logs || [],
          }));

        setReports(formattedReports);
      } else {
        setReports([]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      hasLoaded.current = true;
      setLoading(false);
    }
  };

  const updateReportStatus = async (reportId, status, adminNotes) => {
    try {
      const response = await fetch(`${API_BASE}/api/reports/update-status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
        },
        body: JSON.stringify({
          reportId,
          status,
          adminNotes,
          adminEmail: getCurrentUser(),
        }),
      });

      const data = await response.json();
      if (data.success) {
        showToast(`Report ${status} successfully!`);
        await fetchReports();
        return true;
      } else {
        showToast("Failed to update report status", "error");
        return false;
      }
    } catch {
      showToast("Failed to update report", "error");
      return false;
    }
  };

  const resolveReport = async (reportId, resolvedBy, resolutionNotes) => {
    const actingUser = resolvedBy?.trim() || getCurrentUser();
    try {
      const response = await fetch(`${API_BASE}/api/reports/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
        },
        body: JSON.stringify({ reportId, resolvedBy: actingUser, resolutionNotes }),
      });
      const data = await response.json();
      if (data.success) {
        showToast("Report marked as resolved!");
        await fetchReports();
        return true;
      } else {
        showToast("Failed to resolve report", "error");
        return false;
      }
    } catch {
      showToast("Failed to resolve report", "error");
      return false;
    }
  };

  const pendingCount  = reports.filter((r) => r.status === "pending").length;
  const ongoingCount  = reports.filter((r) => r.status === "approved").length;
  const resolvedCount = reports.filter((r) => r.status === "resolved").length;
  const rejectedCount = reports.filter((r) => r.status === "rejected").length;

  const tabCount = { pending: pendingCount, ongoing: ongoingCount, resolved: resolvedCount, rejected: rejectedCount };

  // Active = still actionable (Pending + Ongoing) — excludes closed-out Resolved/Rejected cases.
  const activeReports     = reports.filter((r) => r.status === "pending" || r.status === "approved");
  const totalReports      = activeReports.length;
  const highPriorityCount = activeReports.filter((r) => r.severity === "high").length;
  const rescueNeededCount = activeReports.filter((r) => r.rescue === true).length;
  const newTodayCount     = activeReports.filter((r) => {
    if (!r.rawTimestamp) return false;
    return new Date(r.rawTimestamp).toDateString() === new Date().toDateString();
  }).length;

  const filteredReports = reports
    .filter((r) => {
      const tabMatch =
        activeTab === "pending"  ? r.status === "pending"  :
        activeTab === "ongoing"  ? r.status === "approved" :
        activeTab === "resolved" ? r.status === "resolved" :
        r.status === "rejected";

      if (!tabMatch) return false;
      if (rescueOnly && !r.rescue) return false;
      if (!search.trim()) return true;

      const q = search.toLowerCase();
      return (
        r.type?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        (typeof r.location === "string" ? r.location : "").toLowerCase().includes(q) ||
        r.reportedBy?.toLowerCase().includes(q)
      );
    })
    // SOS/rescue reports surface first within the current tab, most recent first
    // within each group.
    .sort((a, b) => {
      if (a.rescue !== b.rescue) return a.rescue ? -1 : 1;
      return new Date(b.rawTimestamp || 0) - new Date(a.rawTimestamp || 0);
    });

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500">Loading reports...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-red-500 text-center">
          <p>Error loading reports: {error}</p>
          <button
            onClick={fetchReports}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6">
      {IS_LOCAL_MODE && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 mb-4 text-sm text-amber-800">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <strong>Local Mode Active</strong> — Reports are stored on this device.
              They will sync to CDRRMO when internet is restored.
              {syncStatus && (
                <span className="ml-2">
                  {syncStatus.unsyncedCount > 0
                    ? <span className="font-semibold text-amber-900">· {syncStatus.unsyncedCount} pending sync</span>
                    : <span className="text-green-700">· All synced</span>}
                  {syncStatus.lastSyncAt && (
                    <span className="text-amber-600 ml-1">
                      · Last sync: {new Date(syncStatus.lastSyncAt).toLocaleTimeString()}
                      {syncStatus.lastSyncResult === "failed" && <span className="text-red-600 ml-1">(failed)</span>}
                    </span>
                  )}
                </span>
              )}
            </div>
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-700 text-white text-xs font-semibold rounded-lg hover:bg-amber-800 transition-colors"
            >
              <Download size={13} />
              Save Offline Reports
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 bg-white px-6 py-3 rounded-lg shadow-lg border-l-4 ${
            toast.type === "error" ? "border-red-600" : "border-green-600"
          } max-w-md`}
        >
          <p className="text-gray-900 font-medium">{toast.msg}</p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-6 sm:mb-8">
        <div>
          <h1 className="text-xl sm:text-3xl font-bold text-gray-900">Report Monitoring</h1>
          <p className="text-gray-600 mt-1 text-sm">Active disaster emergency reports</p>
        </div>
        <button
          onClick={fetchReports}
          className="mt-1 px-3 py-2 bg-red-600 text-white rounded-lg text-sm shrink-0"
        >
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 sm:gap-6 mb-6 sm:mb-8">
        <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-xs sm:text-sm text-gray-600 mb-1">Total Reports</p>
          <p className="text-2xl sm:text-3xl font-bold text-gray-900">{totalReports}</p>
          {newTodayCount > 0 && (
            <p className="text-xs sm:text-sm text-blue-600 mt-1 sm:mt-2 flex items-center gap-1">
              <TrendingUp size={13} />
              {newTodayCount} new today
            </p>
          )}
        </div>

        <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-xs sm:text-sm text-gray-600 mb-1">High Priority</p>
          <p className="text-2xl sm:text-3xl font-bold text-red-600">{highPriorityCount}</p>
        </div>

        {/* Rescue Needed — now a toggle that filters the list to SOS/rescue reports only */}
        <button
          type="button"
          onClick={() => setRescueOnly((v) => !v)}
          className={`text-left bg-white p-4 sm:p-6 rounded-xl shadow-sm border transition-colors ${
            rescueOnly ? "border-orange-500 ring-2 ring-orange-200" : "border-gray-100 hover:border-orange-200"
          }`}
        >
          <p className="text-xs sm:text-sm text-gray-600 mb-1 flex items-center gap-1">
            <Siren size={13} className="text-orange-600" />
            Rescue Needed
          </p>
          <p className="text-2xl sm:text-3xl font-bold text-orange-600">{rescueNeededCount}</p>
          {rescueOnly && (
            <p className="text-[11px] text-orange-600 mt-1 font-medium">Showing SOS only · tap to clear</p>
          )}
        </button>
      </div>

      {/* Reports list */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Reports</h2>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-gray-200 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setRescueOnly(false); }}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap shrink-0 ${
                activeTab === tab.key
                  ? "border-red-500 text-red-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                  activeTab === tab.key
                    ? "bg-red-100 text-red-600"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {tabCount[tab.key]}
              </span>
            </button>
          ))}
        </div>

        {/* Search bar + rescue-only toggle */}
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by type, location, description, or reporter…"
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-300 bg-white"
            />
          </div>
          <button
            type="button"
            onClick={() => setRescueOnly((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border shrink-0 transition-colors ${
              rescueOnly
                ? "bg-orange-600 border-orange-600 text-white"
                : "bg-white border-gray-300 text-gray-600 hover:border-orange-300"
            }`}
          >
            <Siren size={14} />
            SOS
          </button>
        </div>

        <div className="space-y-3">
          {filteredReports.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <p className="text-gray-500">No reports found</p>
              <p className="text-sm text-gray-400 mt-2">
                {rescueOnly
                  ? "No SOS/rescue reports in this tab"
                  : search.trim()
                  ? "Try a different search term"
                  : activeTab === "pending"
                  ? "No pending reports — all reports have been reviewed"
                  : activeTab === "ongoing"
                  ? "No ongoing reports — approve a pending report to see it here"
                  : activeTab === "resolved"
                  ? "No resolved reports yet"
                  : "No rejected reports"}
              </p>
            </div>
          ) : (
            filteredReports.map((report) => (
              <ReportTile
                key={report.id}
                {...report}
                onApprove={updateReportStatus}
                onReject={updateReportStatus}
                onResolve={resolveReport}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}