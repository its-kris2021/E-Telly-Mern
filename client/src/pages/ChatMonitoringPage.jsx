import { useState, useEffect, useRef } from "react";
import { Search, ShieldAlert } from "lucide-react";
import ChatReportCaseTile from "../components/admin/ChatReportCaseTile";
import { connectSocket } from "../utils/socket";

const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? "http://localhost:5000");

const TABS = [
  { key: "pending",   label: "Pending" },
  { key: "resolved",  label: "Resolved" },
  { key: "dismissed", label: "Dismissed" },
];

export default function ChatMonitoringPage() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("pending");
  const [search, setSearch] = useState("");
  const hasLoaded = useRef(false);

  const fetchCases = async () => {
    try {
      if (!hasLoaded.current) setLoading(true);
      setError("");
      const res = await fetch(`${API_BASE}/api/chat-monitoring/cases?limit=100`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` },
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to load cases");
      setCases(data.cases);
    } catch (err) {
      setError(err.message);
    } finally {
      hasLoaded.current = true;
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCases();

    const socket = connectSocket();
    socket.on("new_message_report", fetchCases);

    // Fallback poll — catches updates if the socket event is missed.
    const poll = setInterval(fetchCases, 30_000);

    return () => {
      socket.off("new_message_report", fetchCases);
      clearInterval(poll);
    };
  }, []);

  const tabCounts = TABS.reduce((acc, t) => {
    acc[t.key] = cases.filter((c) => c.status === t.key).length;
    return acc;
  }, {});

  const totalReportsFiled = cases.reduce((sum, c) => sum + (c.reportCount || 0), 0);

  const filteredCases = cases
    .filter((c) => c.status === activeTab)
    .filter((c) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        c.messageSnapshot?.toLowerCase().includes(q) ||
        c.reportedUser?.name?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => new Date(b.lastReportedAt) - new Date(a.lastReportedAt));

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500">Loading chat reports...</div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 sm:mb-8">
        <div>
          <h1 className="text-xl sm:text-3xl font-bold text-gray-900">Chat Monitoring</h1>
          <p className="text-gray-600 mt-1 text-sm">Reported chat messages and moderation cases</p>
        </div>
        <button
          onClick={fetchCases}
          className="mt-1 px-3 py-2 bg-red-600 text-white rounded-lg text-sm shrink-0"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border-l-4 border-red-600 text-red-700 text-sm px-4 py-3 rounded">{error}</div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-6 mb-6 sm:mb-8">
        <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-xs sm:text-sm text-gray-600 mb-1">Total Cases</p>
          <p className="text-2xl sm:text-3xl font-bold text-gray-900">{cases.length}</p>
        </div>
        <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-xs sm:text-sm text-gray-600 mb-1">Total Reports Filed</p>
          <p className="text-2xl sm:text-3xl font-bold text-red-600 flex items-center gap-2">
            <ShieldAlert size={22} />
            {totalReportsFiled}
          </p>
        </div>
        <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-100 col-span-2 sm:col-span-1">
          <p className="text-xs sm:text-sm text-gray-600 mb-1">Pending Review</p>
          <p className="text-2xl sm:text-3xl font-bold text-orange-500">{tabCounts.pending || 0}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by message content or reported user…"
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-300"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${
              activeTab === tab.key
                ? "bg-gray-900 text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {tab.label} {tabCounts[tab.key] > 0 && <span className="opacity-70">({tabCounts[tab.key]})</span>}
          </button>
        ))}
      </div>

      {/* Case list */}
      {filteredCases.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200 text-gray-500 text-sm">
          <ShieldAlert className="mx-auto mb-2 text-gray-300" size={28} />
          No {activeTab} chat reports.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredCases.map((c) => (
            <ChatReportCaseTile key={c.id} summary={c} onChanged={fetchCases} />
          ))}
        </div>
      )}
    </div>
  );
}
