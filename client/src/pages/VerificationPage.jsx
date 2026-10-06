import VerificationTile from "../components/admin/VerificationTile";
import { useState, useEffect, useRef } from "react";
import { Search, RefreshCw, ShieldCheck } from "lucide-react";

const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? `http://${window.location.hostname}:5000`);

const TABS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

export default function VerificationPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("pending");
  const [search, setSearch] = useState("");
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoaded = useRef(false);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchRequests = async () => {
    try {
      if (!hasLoaded.current) setLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE}/api/verification/requests?limit=100`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` },
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();
      setRequests(data.success && data.requests ? data.requests : []);
    } catch (err) {
      setError(err.message);
    } finally {
      hasLoaded.current = true;
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
    const poll = setInterval(fetchRequests, 30_000);
    return () => clearInterval(poll);
  }, []);

  const updateRequestStatus = async (requestId, status, adminNotes) => {
    try {
      const response = await fetch(`${API_BASE}/api/verification/requests/${requestId}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
        },
        body: JSON.stringify({ status, adminNotes }),
      });
      const data = await response.json();
      if (data.success) {
        showToast(`Request ${status} successfully!`);
        await fetchRequests();
        return true;
      }
      showToast("Failed to update request", "error");
      return false;
    } catch {
      showToast("Failed to update request", "error");
      return false;
    }
  };

  const pendingCount = requests.filter((r) => r.status === "pending").length;
  const approvedCount = requests.filter((r) => r.status === "approved").length;
  const rejectedCount = requests.filter((r) => r.status === "rejected").length;
  const tabCount = { pending: pendingCount, approved: approvedCount, rejected: rejectedCount };

  const filteredRequests = requests
    .filter((r) => r.status === activeTab)
    .filter((r) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        r.userName?.toLowerCase().includes(q) ||
        r.userEmail?.toLowerCase().includes(q) ||
        r.declaredBarangay?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500">Loading verification requests...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-red-500 text-center">
          <p>Error loading requests: {error}</p>
          <button onClick={fetchRequests} className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6">
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
          <h1 className="text-xl sm:text-3xl font-bold text-gray-900">Resident Verification</h1>
          <p className="text-gray-600 mt-1 text-sm">Review proof-of-residency requests</p>
        </div>
        <button
          onClick={async () => {
            setRefreshing(true);
            await fetchRequests();
            setRefreshing(false);
          }}
          disabled={refreshing}
          className="mt-1 flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm shrink-0 disabled:opacity-60"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 sm:gap-6 mb-6 sm:mb-8">
        <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-xs sm:text-sm text-gray-600 mb-1 flex items-center gap-1">
            <ShieldCheck size={13} className="text-orange-500" />
            Pending
          </p>
          <p className="text-2xl sm:text-3xl font-bold text-orange-500">{pendingCount}</p>
        </div>
        <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-xs sm:text-sm text-gray-600 mb-1">Approved</p>
          <p className="text-2xl sm:text-3xl font-bold text-green-600">{approvedCount}</p>
        </div>
        <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-xs sm:text-sm text-gray-600 mb-1">Rejected</p>
          <p className="text-2xl sm:text-3xl font-bold text-red-600">{rejectedCount}</p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Requests</h2>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-gray-200 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap shrink-0 ${
                activeTab === tab.key
                  ? "border-indigo-500 text-indigo-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                  activeTab === tab.key ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600"
                }`}
              >
                {tabCount[tab.key]}
              </span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or barangay…"
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
            />
          </div>
        </div>

        <div className="space-y-3">
          {filteredRequests.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <p className="text-gray-500">No requests found</p>
              <p className="text-sm text-gray-400 mt-2">
                {search.trim()
                  ? "Try a different search term"
                  : activeTab === "pending"
                  ? "No pending verification requests"
                  : activeTab === "approved"
                  ? "No approved requests yet"
                  : "No rejected requests"}
              </p>
            </div>
          ) : (
            filteredRequests.map((request) => (
              <VerificationTile
                key={request.id}
                {...request}
                onApprove={updateRequestStatus}
                onReject={updateRequestStatus}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
