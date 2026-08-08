import { useState, useEffect, useRef } from "react";
import { X, AlertTriangle, Send } from "lucide-react";
import ModalShell from "../ui/ModalShell";
import { API_BASE, authHeaders, formatDate, getStatusColor, getStatusDotColor } from "./helpers";
import LogModal from "./LogModal";
import { connectSocket } from "../../utils/socket";
import { getUserRole } from "../../config/roleModules";
import { isOpsRole } from "../../config/roles";

const PLEDGE_BADGE = {
  pending:  "bg-gray-100 text-gray-600",
  accepted: "bg-purple-100 text-purple-700",
  declined: "bg-gray-100 text-gray-400 line-through",
  withdrawn: null, // hidden
};

export default function RequestDetailModal({ req, onClose, onRefresh }) {
  const [action,     setAction]     = useState(null);
  const [note,       setNote]       = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState("");
  const [showLog,    setShowLog]    = useState(false);

  // Message thread state
  const [messages,    setMessages]    = useState([]);
  const [msgLoading,  setMsgLoading]  = useState(false);
  const [msgText,     setMsgText]     = useState("");
  const [msgSending,  setMsgSending]  = useState(false);
  const [msgError,    setMsgError]    = useState("");
  const msgEndRef = useRef(null);

  const isAdmin = isOpsRole(getUserRole());

  const isTerminal = ["fulfilled", "cancelled"].includes(req.status);
  const canAct = !isTerminal && isAdmin;
  const lastEntry = req.actionLog?.[req.actionLog.length - 1];

  const visiblePledges = (req.pledges || []).filter((p) => p.status !== "withdrawn");

  // Load messages and set up Socket.IO when modal opens
  useEffect(() => {
    const loadMessages = async () => {
      setMsgLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/api/community/requests/${req._id}/messages`,
          { headers: authHeaders() },
        );
        const data = await res.json();
        if (data.success) setMessages(data.messages);
      } catch {
        // non-fatal
      } finally {
        setMsgLoading(false);
      }
    };

    loadMessages();

    // Join the request's Socket.IO room to receive live messages. Use
    // connectSocket() (not getSocket()) so a connection is guaranteed even when
    // the admin opened the Community page directly and no other page has
    // established the socket yet — otherwise messages only appear on refresh.
    const socket = connectSocket();
    const joinRoom = () => socket.emit("join_request", { requestId: req._id });
    joinRoom();
    // Re-join on every (re)connect so live messages keep flowing after a drop.
    socket.on("connect", joinRoom);

    const handler = (data) => {
      setMessages((prev) => {
        // Avoid duplicate messages if we also appended locally on send
        if (prev.some((m) => m._id === data.message._id)) return prev;
        return [...prev, data.message];
      });
    };
    socket.on("new_message", handler);
    return () => {
      socket.off("new_message", handler);
      socket.off("connect", joinRoom);
    };
  }, [req._id]);

  // Scroll to bottom when messages update
  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleAction = async () => {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/community/requests/${req._id}/${action}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ note }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Action failed.");
      onRefresh();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const resetAction = () => { setAction(null); setNote(""); setError(""); };

  const handleSendMessage = async () => {
    if (!msgText.trim() || msgSending) return;
    setMsgSending(true);
    setMsgError("");
    try {
      const res = await fetch(
        `${API_BASE}/api/community/requests/${req._id}/messages`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ text: msgText.trim() }),
        },
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to send.");
      // The message may already be in state from the Socket.IO "new_message"
      // broadcast (which can arrive before this HTTP response). Dedup by _id
      // so the admin's own message isn't appended twice.
      setMessages((prev) =>
        prev.some((m) => m._id === data.message._id)
          ? prev
          : [...prev, data.message]
      );
      setMsgText("");
    } catch (err) {
      setMsgError(err.message);
    } finally {
      setMsgSending(false);
    }
  };

  if (showLog) return <LogModal item={req} onClose={() => setShowLog(false)} />;

  return (
    <ModalShell onClose={onClose} size="xl" flex>
      {/* Header */}
      <div className="shrink-0 flex items-start justify-between p-6 border-b border-gray-200">
        <div>
          <h2 className="text-xl font-bold text-gray-900 capitalize">{req.category} Request</h2>
          <div className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium">
            <div className={`w-2 h-2 rounded-full ${getStatusDotColor(req.status)}`} />
            <span className={getStatusColor(req.status)}>
              {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
            </span>
          </div>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 min-h-0 p-6 space-y-4 overflow-y-auto">
        {/* Request info */}
        <div>
          <p className="text-sm font-medium text-gray-700">Requester</p>
          <p className="text-gray-900 text-sm mt-1 font-semibold">{req.requesterName}</p>
          <p className="text-gray-500 text-xs mt-0.5">{req.requesterEmail}</p>
        </div>

        <div>
          <p className="text-sm font-medium text-gray-700">Address</p>
          <p className="text-gray-900 text-sm mt-1">{req.address}</p>
          <p className="text-gray-500 text-xs mt-0.5">{req.barangay}</p>
        </div>

        <div>
          <p className="text-sm font-medium text-gray-700">Item Requested</p>
          <p className="text-gray-900 text-sm mt-1">{req.itemDescription}</p>
          <p className="text-gray-500 text-xs mt-0.5 font-mono">{req.quantity} {req.unit}</p>
        </div>

        {req.reason && (
          <div>
            <p className="text-sm font-medium text-gray-700">Reason</p>
            <p className="text-gray-900 text-sm mt-1">{req.reason}</p>
          </div>
        )}

        <div>
          <p className="text-sm font-medium text-gray-700">Submitted</p>
          <p className="text-gray-900 text-sm mt-1">{formatDate(req.createdAt)}</p>
        </div>

        {lastEntry && (
          <div className={`p-3 rounded-lg border ${
            ["cancelled"].includes(req.status)
              ? "bg-red-50 border-red-200"
              : "bg-green-50 border-green-200"
          }`}>
            <p className="text-sm font-medium capitalize">
              {lastEntry.action} by {lastEntry.by}
            </p>
            {lastEntry.note && (
              <p className="text-sm mt-1 text-gray-700">"{lastEntry.note}"</p>
            )}
          </div>
        )}

        {/* Community Offers (pledges) */}
        {visiblePledges.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">
              Community Offers ({visiblePledges.length})
            </p>
            <div className="space-y-2">
              {visiblePledges.map((p) => (
                <div
                  key={p._id}
                  className="p-3 rounded-lg border border-gray-100 bg-gray-50 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${p.status === "declined" ? "text-gray-400 line-through" : "text-gray-900"}`}>
                      {p.name}
                    </p>
                    {p.phone && (
                      <p className="text-xs text-gray-400 mt-0.5">{p.phone}</p>
                    )}
                    {p.message && (
                      <p className={`text-xs mt-1 ${p.status === "declined" ? "text-gray-400" : "text-gray-600"}`}>
                        "{p.message}"
                      </p>
                    )}
                  </div>
                  {PLEDGE_BADGE[p.status] && (
                    <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${PLEDGE_BADGE[p.status]}`}>
                      {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Message Thread */}
        <div>
          <p className="text-sm font-semibold text-gray-700 mb-2">Message Thread</p>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="p-3 bg-gray-50 min-h-[120px] max-h-[240px] overflow-y-auto space-y-2">
              {msgLoading ? (
                <p className="text-xs text-gray-400 text-center py-4">Loading messages…</p>
              ) : messages.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">
                  {req.status === "matched"
                    ? "No messages yet. Start the conversation."
                    : "Messages are available once a helper is matched."}
                </p>
              ) : (
                messages.map((m) => (
                  <div key={m._id} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-gray-700">{m.senderName}</span>
                      {m.senderRole !== "resident" && (
                        <span className="px-1.5 py-px rounded text-xs font-medium bg-blue-100 text-blue-700 capitalize">
                          {m.senderRole === "barangay_official" ? "Barangay" : "CDRRMO"}
                        </span>
                      )}
                      <span className="text-xs text-gray-400">{formatDate(m.createdAt)}</span>
                    </div>
                    <p className="text-sm text-gray-800 ml-0">{m.text}</p>
                  </div>
                ))
              )}
              <div ref={msgEndRef} />
            </div>

            {/* Input — only for matched requests */}
            {req.status === "matched" && isAdmin && (
              <div className="border-t border-gray-200 p-2 flex gap-2">
                <input
                  type="text"
                  value={msgText}
                  onChange={(e) => setMsgText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
                  placeholder="Type a message…"
                  maxLength={1000}
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-700"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!msgText.trim() || msgSending}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  <Send size={15} />
                </button>
              </div>
            )}
          </div>
          {msgError && (
            <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
              <AlertTriangle size={11} /> {msgError}
            </p>
          )}
        </div>

        {/* Note textarea (shown when action is being confirmed) */}
        {action && (
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">
              Note (optional)
            </label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note for the record…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-700"
            />
          </div>
        )}

        {error && (
          <p className="text-xs text-red-500 flex items-center gap-1">
            <AlertTriangle size={11} /> {error}
          </p>
        )}
      </div>

      {/* Footer actions */}
      <div className="shrink-0 p-6 border-t border-gray-200 space-y-3">
        {isAdmin && (
          <button
            onClick={() => setShowLog(true)}
            className="w-full py-1.5 text-sm text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
          >
            View action log
          </button>
        )}

        {canAct && !action && (
          <div className="space-y-3">
            {req.status === "matched" && (
              <button
                onClick={() => setAction("release")}
                className="w-full px-4 py-2 border border-amber-400 text-amber-700 font-semibold rounded-lg hover:bg-amber-50 transition-colors text-sm"
              >
                Release Match (helper backed out)
              </button>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setAction("cancel")}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-600 font-semibold rounded-lg hover:bg-gray-50 transition-colors text-sm"
              >
                Cancel Request
              </button>
              <button
                onClick={() => setAction("fulfill")}
                className="flex-1 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors text-sm"
              >
                Force Fulfill
              </button>
            </div>
          </div>
        )}

        {action && (
          <div className="flex gap-3">
            <button
              onClick={resetAction}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-600 font-semibold rounded-lg hover:bg-gray-50 transition-colors text-sm"
            >
              Back
            </button>
            <button
              onClick={handleAction}
              disabled={submitting}
              className={`flex-1 px-4 py-2 font-semibold rounded-lg text-white transition-colors text-sm disabled:opacity-50
                ${action === "fulfill"
                  ? "bg-blue-600 hover:bg-blue-700"
                  : action === "release"
                  ? "bg-amber-500 hover:bg-amber-600"
                  : "bg-red-600 hover:bg-red-700"}`}
            >
              {submitting
                ? "Saving…"
                : `Confirm ${action.charAt(0).toUpperCase() + action.slice(1)}`}
            </button>
          </div>
        )}

        {isTerminal && (
          <div className={`w-full text-center py-2 rounded-lg text-sm font-medium ${
            req.status === "fulfilled" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-500"
          }`}>
            This request has been {req.status}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
