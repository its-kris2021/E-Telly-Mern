import { useState } from "react";
import { X, ShieldAlert, MessageSquare } from "lucide-react";
import ModalShell from "../ui/ModalShell";
import { barangayLabel } from "../../config/barangays";

const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? "http://localhost:5000");

const REASON_LABELS = {
  spam: "Spam",
  abusive: "Abusive / offensive",
  bullying: "Bullying",
  harassment: "Harassment",
  threats: "Threats or intimidation",
  hate_speech: "Hate speech",
  inappropriate_content: "Inappropriate content",
  scam: "Scam / fraud",
  violence: "Violence or dangerous content",
  other: "Other",
};

const STATUS_DISPLAY = {
  pending:   { dot: "bg-orange-400 animate-pulse", text: "Pending",   textClass: "text-orange-500" },
  resolved:  { dot: "bg-green-500",                 text: "Resolved", textClass: "text-green-600" },
  dismissed: { dot: "bg-gray-400",                  text: "Dismissed", textClass: "text-gray-500" },
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

export default function ChatReportCaseTile({ summary, onChanged }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [noteText, setNoteText] = useState("");
  // Which confirmation form is showing for the pending-case action row:
  // null | "warn" | "dismiss".
  const [pendingAction, setPendingAction] = useState(null);
  const [actionNote, setActionNote] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  const statusDisplay = STATUS_DISPLAY[detail?.case.status ?? summary.status] || STATUS_DISPLAY.pending;

  const openModal = async () => {
    setIsModalOpen(true);
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/chat-monitoring/cases/${summary.messageId}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to load case");
      setDetail(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const dismissCase = async (note) => {
    setIsUpdating(true);
    try {
      const res = await fetch(`${API_BASE}/api/chat-monitoring/cases/${summary.messageId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ status: "dismissed", note }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to dismiss case");
      setDetail((prev) => (prev ? { ...prev, case: data.case } : prev));
      onChanged?.();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setIsUpdating(false);
    }
  };

  const sendWarning = async (note) => {
    setIsUpdating(true);
    try {
      const res = await fetch(`${API_BASE}/api/chat-monitoring/cases/${summary.messageId}/warn`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ note }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to send warning");
      setDetail((prev) => (prev ? { ...prev, case: data.case } : prev));
      onChanged?.();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setIsUpdating(false);
    }
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    setIsUpdating(true);
    try {
      const res = await fetch(`${API_BASE}/api/chat-monitoring/cases/${summary.messageId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ note: noteText.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to add note");
      setDetail((prev) => (prev ? { ...prev, moderatorNotes: data.moderatorNotes } : prev));
      setNoteText("");
    } catch (err) {
      setError(err.message);
    } finally {
      setIsUpdating(false);
    }
  };

  const confirmPendingAction = async () => {
    const note = actionNote.trim();
    const ok = pendingAction === "warn" ? await sendWarning(note) : await dismissCase(note);
    if (ok) {
      setPendingAction(null);
      setActionNote("");
    }
  };

  const reasonChips = Object.entries(summary.reasonCounts || {}).filter(([, count]) => count > 0);

  return (
    <>
      <div
        onClick={openModal}
        className="bg-white p-4 rounded-xl border border-gray-200 hover:border-gray-400 cursor-pointer hover:shadow-md transition-all"
      >
        <div className="flex items-start gap-4">
          <div className="p-2 rounded-lg text-red-600 bg-red-50">
            <ShieldAlert size={18} strokeWidth={1.8} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-semibold text-gray-900">
                    {summary.reportedUser?.name || "Unknown user"}
                  </h3>
                  {summary.reportedUser?.restricted && (
                    <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold uppercase tracking-wide">
                      Restricted
                    </span>
                  )}
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${statusDisplay.dot}`} />
                    <span className={`text-xs font-semibold ${statusDisplay.textClass}`}>{statusDisplay.text}</span>
                  </div>
                </div>
                <p className="text-sm text-gray-600 mt-1 line-clamp-2">{summary.messageSnapshot}</p>
              </div>
              <span className="px-2 py-1 rounded text-xs font-semibold whitespace-nowrap shrink-0 bg-gray-100 text-gray-700 flex items-center gap-1">
                <MessageSquare size={12} />
                {summary.reportCount} report{summary.reportCount === 1 ? "" : "s"}
              </span>
            </div>

            <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 flex-wrap">
              {summary.reportedUser?.barangayKey && (
                <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">
                  Brgy. {barangayLabel(summary.reportedUser.barangayKey)}
                </span>
              )}
              {summary.reportedUser?.warningCount > 0 && (
                <span className="font-medium text-orange-600">
                  Warnings: {summary.reportedUser.warningCount}
                </span>
              )}
              <span>{formatDate(summary.lastReportedAt)}</span>
            </div>
          </div>
        </div>
      </div>

      {isModalOpen && (
        <ModalShell onClose={() => setIsModalOpen(false)} size="xl">
          <div className="flex items-start justify-between p-6 border-b border-gray-200">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-2xl font-bold text-gray-900">{summary.reportedUser?.name || "Unknown user"}</h2>
                {(detail?.case.reportedUser.restricted ?? summary.reportedUser?.restricted) && (
                  <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold uppercase tracking-wide">
                    Restricted
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${statusDisplay.dot}`} />
                  <span className={`text-sm font-semibold ${statusDisplay.textClass}`}>{statusDisplay.text}</span>
                </div>
                {(detail?.case.reportedUser.warningCount ?? summary.reportedUser?.warningCount) > 0 && (
                  <span className="text-xs font-medium text-orange-600">
                    Warnings: {detail?.case.reportedUser.warningCount ?? summary.reportedUser?.warningCount}
                  </span>
                )}
              </div>
            </div>
            <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="p-6 space-y-4">
            {loading && <p className="text-sm text-gray-400 text-center py-8">Loading case…</p>}
            {error && <div className="bg-red-50 border-l-4 border-red-600 text-red-700 text-sm px-4 py-3 rounded">{error}</div>}

            {detail && !loading && (
              <>
                <div>
                  <p className="text-sm font-medium text-gray-700">Reported Message</p>
                  <p className="text-gray-900 text-sm mt-1 bg-gray-50 border border-gray-200 rounded-lg p-3">
                    {detail.case.messageSnapshot}
                  </p>
                </div>

                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1.5">Reasons Reported</p>
                  <div className="flex flex-wrap gap-1.5">
                    {reasonChips.map(([reason, count]) => (
                      <span key={reason} className="px-2 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
                        {REASON_LABELS[reason] || reason} × {count}
                      </span>
                    ))}
                  </div>
                </div>

                {detail.conversationContext?.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-1.5">Conversation Context</p>
                    <div className="max-h-56 overflow-y-auto space-y-1.5 bg-gray-50 border border-gray-200 rounded-lg p-3">
                      {detail.conversationContext.map((m) => (
                        <div
                          key={m.id}
                          className={`text-xs rounded-lg px-2.5 py-1.5 max-w-[85%] ${
                            m.isReportedMessage
                              ? "bg-red-100 border border-red-300 ml-auto"
                              : "bg-white border border-gray-200"
                          }`}
                        >
                          <p className="text-gray-900">{m.text}</p>
                          <p className="text-gray-400 mt-0.5">{formatDate(m.timestamp)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1.5">Individual Reports ({detail.reports.length})</p>
                  <div className="space-y-2">
                    {detail.reports.map((r, i) => (
                      <div key={i} className="text-xs border border-gray-200 rounded-lg p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-gray-700">{REASON_LABELS[r.reason] || r.reason}</span>
                          <span className="text-gray-400">{formatDate(r.createdAt)}</span>
                        </div>
                        {r.details && <p className="text-gray-600 mt-1">{r.details}</p>}
                        {r.reporter && (
                          <p className="text-gray-400 mt-1">
                            Reported by {r.reporter.name} ({r.reporter.email})
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1.5">Moderation Notes</p>
                  <div className="space-y-2 mb-2">
                    {detail.moderatorNotes.length === 0 && (
                      <p className="text-xs text-gray-400">No internal notes yet.</p>
                    )}
                    {detail.moderatorNotes.map((n, i) => (
                      <div key={i} className="text-xs bg-blue-50 border border-blue-100 rounded-lg p-2.5">
                        <p className="text-gray-800">{n.note}</p>
                        <p className="text-gray-400 mt-1">{n.byName} ({n.byRole}) · {formatDate(n.at)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Add an internal moderation note…"
                      className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                    <button
                      onClick={addNote}
                      disabled={isUpdating || !noteText.trim()}
                      className="px-4 py-2 bg-gray-800 text-white text-sm font-semibold rounded-lg hover:bg-gray-900 transition-colors disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {detail.logs?.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">Activity Log</p>
                    <div className="space-y-1">
                      {detail.logs.map((log, i) => (
                        <div key={i} className="flex gap-3 text-xs">
                          <div className="flex flex-col items-center pt-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0" />
                            {i < detail.logs.length - 1 && <div className="w-px flex-1 bg-gray-200 mt-1 mb-0.5" />}
                          </div>
                          <div className="pb-2">
                            <span className="font-semibold text-gray-700 capitalize">{log.action.replace("_", " ")}</span>
                            <span className="text-gray-500"> by {log.byName} ({log.byRole})</span>
                            {log.notes && <p className="text-gray-500 mt-0.5">{log.notes}</p>}
                            <p className="text-gray-400 mt-0.5">{formatDate(log.at)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {detail && detail.case.status === "pending" && (
            <div className="p-6 border-t border-gray-200">
              {pendingAction ? (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-gray-700">
                    {pendingAction === "warn"
                      ? `Send Warning #${detail.case.reportedUser.warningCount + 1} — optional note`
                      : "Why isn't this a violation? (optional)"}
                  </p>
                  <textarea
                    value={actionNote}
                    onChange={(e) => setActionNote(e.target.value)}
                    placeholder={pendingAction === "warn" ? "Note for the moderation record…" : "e.g. context, false report, resolved elsewhere…"}
                    rows={3}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setPendingAction(null); setActionNote(""); }}
                      disabled={isUpdating}
                      className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors text-sm disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={confirmPendingAction}
                      disabled={isUpdating}
                      className={`flex-1 px-4 py-2 text-white font-semibold rounded-lg transition-colors text-sm disabled:opacity-50 ${
                        pendingAction === "warn" ? "bg-red-600 hover:bg-red-700" : "bg-gray-600 hover:bg-gray-700"
                      }`}
                    >
                      {isUpdating
                        ? "Saving…"
                        : pendingAction === "warn"
                          ? `Confirm Warning #${detail.case.reportedUser.warningCount + 1}`
                          : "Confirm Dismiss"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <button
                    onClick={() => setPendingAction("dismiss")}
                    disabled={isUpdating}
                    className="flex-1 px-4 py-2 border border-gray-400 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors text-sm disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                  <button
                    onClick={() => setPendingAction("warn")}
                    disabled={isUpdating}
                    className="flex-1 px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors text-sm disabled:opacity-50"
                  >
                    Send Warning #{detail.case.reportedUser.warningCount + 1}
                  </button>
                </div>
              )}
            </div>
          )}

          {detail && (detail.case.status === "resolved" || detail.case.status === "dismissed") && (
            <div className="p-6 border-t border-gray-200">
              <div className={`w-full text-center py-2 rounded-lg text-sm font-medium ${
                detail.case.status === "resolved" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"
              }`}>
                {[...detail.logs].reverse().find((l) => l.action === "status_change")?.notes
                  || (detail.case.status === "resolved" ? "Resolved" : "Dismissed")}
                {detail.case.reviewedBy ? ` — by ${detail.case.reviewedBy}` : ""}
                {detail.case.reviewedAt ? ` · ${formatDate(detail.case.reviewedAt)}` : ""}
              </div>
            </div>
          )}
        </ModalShell>
      )}
    </>
  );
}
