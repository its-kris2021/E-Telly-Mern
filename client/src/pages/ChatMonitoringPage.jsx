import { useState, useEffect } from "react";
import { MessageSquare } from "lucide-react";
import { API_BASE, authHeaders, formatDate } from "../components/community/helpers";

const SENDER_LABELS = {
  cdrrmo:            "CDRRMO",
  barangay_official:  "Barangay",
  resident:           "Resident",
};

export default function ChatMonitoringPage() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res  = await fetch(`${API_BASE}/api/community/messages?limit=100`, { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error);
        setMessages(data.messages);
      } catch {
        setError("Failed to load chat threads.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Chat Monitoring</h1>
        <p className="text-sm text-gray-500 mt-1">
          City-wide read-only view of resource-request coordination chats.
        </p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border-l-4 border-red-600 text-red-700 text-sm px-4 py-3 rounded">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Loading…</div>
      ) : messages.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200 text-gray-500 text-sm">
          <MessageSquare className="mx-auto mb-2 text-gray-300" size={28} />
          No chat messages yet.
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-50">
          {messages.map((m) => (
            <div key={m._id} className="px-6 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-gray-900">
                  {m.senderName}
                  <span className="ml-1.5 text-xs font-normal text-gray-400">
                    ({SENDER_LABELS[m.senderRole] ?? m.senderRole})
                  </span>
                </p>
                <span className="text-xs text-gray-400 shrink-0">{formatDate(m.createdAt)}</span>
              </div>
              <p className="text-sm text-gray-700 mt-0.5">{m.text}</p>
              {m.request && (
                <p className="text-xs text-gray-400 mt-1">
                  Re: {m.request.itemDescription} — {m.request.barangay} · {m.request.requesterName}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
