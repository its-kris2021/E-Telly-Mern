import { useState } from "react";
import { X, FileCheck } from "lucide-react";
import ModalShell from "../ui/ModalShell";
import { timeAgo } from "../../utils/timeHelpers";

const DOCUMENT_TYPE_LABELS = {
  barangay_certificate: "Barangay Certificate / Certificate of Residency",
  government_id: "Government-issued ID (Antipolo address)",
  barangay_clearance: "Barangay Clearance",
  other: "Other proof of residency",
};

export default function VerificationTile({
  id,
  userName,
  userEmail,
  declaredBarangay,
  declaredCity,
  documentType,
  documentUrls = [],
  status = "pending",
  adminNotes = null,
  reviewedBy = null,
  reviewedAt = null,
  logs = [],
  createdAt,
  onApprove,
  onReject,
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(status);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const documentLabel = DOCUMENT_TYPE_LABELS[documentType] || documentType;
  const relativeTime = createdAt ? timeAgo(createdAt) : "";

  const getStatusDisplay = () => {
    if (currentStatus === "approved")
      return { dot: "bg-green-500", text: "Approved", textClass: "text-green-600" };
    if (currentStatus === "rejected")
      return { dot: "bg-red-500", text: "Rejected", textClass: "text-red-600" };
    return { dot: "bg-orange-400", text: "Pending", textClass: "text-orange-500" };
  };
  const statusDisplay = getStatusDisplay();

  const handleApprove = async (e) => {
    e.stopPropagation();
    if (!onApprove || currentStatus !== "pending") return;
    setIsUpdating(true);
    try {
      await onApprove(id, "approved", "Approved by admin");
      setCurrentStatus("approved");
    } catch {}
    setIsUpdating(false);
    setIsModalOpen(false);
  };

  const handleReject = async (e) => {
    e.stopPropagation();
    if (!onReject || currentStatus !== "pending") return;
    setIsUpdating(true);
    try {
      await onReject(id, "rejected", rejectReason.trim() || "Rejected by admin");
      setCurrentStatus("rejected");
      setShowRejectForm(false);
      setRejectReason("");
    } catch {}
    setIsUpdating(false);
    setIsModalOpen(false);
  };

  return (
    <>
      {/* Tile */}
      <div
        onClick={() => setIsModalOpen(true)}
        className="bg-white p-4 rounded-xl border border-gray-200 hover:border-gray-400 cursor-pointer hover:shadow-md transition-all"
      >
        <div className="flex items-start gap-4">
          <div className="p-2 rounded-lg text-indigo-600 bg-indigo-50">
            <FileCheck size={18} strokeWidth={1.8} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-semibold text-gray-900">{userName}</h3>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${statusDisplay.dot}`} />
                    <span className={`text-xs font-semibold ${statusDisplay.textClass}`}>{statusDisplay.text}</span>
                  </div>
                </div>
                <p className="text-sm text-gray-600 mt-1">{documentLabel}</p>
              </div>
            </div>

            <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 flex-wrap">
              <span className="truncate">{userEmail}</span>
              {declaredBarangay && (
                <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium shrink-0">
                  Brgy. {declaredBarangay}
                </span>
              )}
              <span title={createdAt}>{relativeTime}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      {isModalOpen && (
        <ModalShell onClose={() => setIsModalOpen(false)} size="xl">
          {/* Modal Header */}
          <div className="flex items-start justify-between p-6 border-b border-gray-200">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{userName}</h2>
              <div className="mt-2 flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full shrink-0 ${statusDisplay.dot}`} />
                <span className={`text-sm font-semibold ${statusDisplay.textClass}`}>{statusDisplay.text}</span>
              </div>
            </div>
            <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <X size={20} />
            </button>
          </div>

          {/* Document thumbnails */}
          {documentUrls.length > 0 && (
            <div className="flex gap-2 p-4 bg-gray-50 overflow-x-auto">
              {documentUrls.map((url, i) => (
                <button
                  key={url + i}
                  onClick={(e) => { e.stopPropagation(); setLightboxUrl(url); }}
                  className="relative w-28 h-28 shrink-0 overflow-hidden rounded-lg bg-gray-100 block group cursor-zoom-in border border-gray-200"
                >
                  <img src={url} alt={`Document ${i + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}

          {/* Details */}
          <div className="p-6 space-y-4">
            <div>
              <p className="text-sm font-medium text-gray-700">Account</p>
              <p className="text-gray-900 text-sm mt-1">{userName} · {userEmail}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700">Declared Location</p>
              <p className="text-gray-900 text-sm mt-1">
                {[declaredBarangay && `Brgy. ${declaredBarangay}`, declaredCity].filter(Boolean).join(", ")}
              </p>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700">Document Type</p>
              <p className="text-gray-900 text-sm mt-1">{documentLabel}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700">Submitted</p>
              <p className="text-gray-900 text-sm mt-1">
                {createdAt ? new Date(createdAt).toLocaleString("en-PH") : ""}
                {relativeTime && <span className="text-gray-500"> · {relativeTime}</span>}
              </p>
            </div>

            {reviewedBy && (
              <div>
                <p className="text-sm font-medium text-gray-700">Reviewed By</p>
                <p className="text-gray-900 text-sm mt-1">
                  {reviewedBy}
                  {reviewedAt && <span className="text-gray-500"> · {new Date(reviewedAt).toLocaleString("en-PH")}</span>}
                </p>
              </div>
            )}

            {adminNotes && (
              <div className={`p-3 rounded-lg ${currentStatus === "rejected" ? "bg-red-50 border border-red-200" : "bg-blue-50 border border-blue-200"}`}>
                <p className="text-sm font-medium">
                  {currentStatus === "rejected" ? "Rejection Reason" : "Admin Notes"}:
                </p>
                <p className="text-sm mt-1">{adminNotes}</p>
              </div>
            )}

            {/* Activity Log — this whole page is system_admin only, so always show it */}
            {logs.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Activity Log</p>
                <div className="space-y-1">
                  {logs.map((log, i) => (
                    <div key={i} className="flex gap-3 text-xs">
                      <div className="flex flex-col items-center pt-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0" />
                        {i < logs.length - 1 && <div className="w-px flex-1 bg-gray-200 mt-1 mb-0.5" />}
                      </div>
                      <div className="pb-2">
                        <span className="font-semibold text-gray-700 capitalize">{log.action?.replaceAll("_", " ")}</span>
                        <span className="text-gray-500"> by {log.byName}</span>
                        {log.notes && <p className="text-gray-500 mt-0.5">{log.notes}</p>}
                        <p className="text-gray-400 mt-0.5">
                          {new Date(log.at).toLocaleString("en-PH", {
                            month: "short", day: "numeric", year: "numeric",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer actions */}
          {currentStatus === "pending" && (
            <div className="p-6 border-t border-gray-200">
              {showRejectForm ? (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-gray-700">Reason for Rejection</p>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Explain why this request is being rejected…"
                    rows={3}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowRejectForm(false); setRejectReason(""); }}
                      disabled={isUpdating}
                      className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors text-sm disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleReject}
                      disabled={isUpdating}
                      className="flex-1 px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors text-sm disabled:opacity-50"
                    >
                      {isUpdating ? "Processing..." : "Confirm Rejection"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowRejectForm(true); }}
                    disabled={isUpdating}
                    className="flex-1 px-4 py-2 border border-red-500 text-red-600 font-semibold rounded-lg hover:bg-red-50 transition-colors text-sm disabled:opacity-50 cursor-pointer"
                  >
                    Reject
                  </button>
                  <button
                    onClick={handleApprove}
                    disabled={isUpdating}
                    className="flex-1 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors text-sm disabled:opacity-50 cursor-pointer"
                  >
                    {isUpdating ? "Processing..." : "Approve"}
                  </button>
                </div>
              )}
            </div>
          )}

          {currentStatus === "approved" && (
            <div className="p-6 border-t border-gray-200">
              <div className="w-full text-center py-2 rounded-lg text-sm font-medium bg-green-50 text-green-700">
                This resident has been verified
              </div>
            </div>
          )}

          {currentStatus === "rejected" && (
            <div className="p-6 border-t border-gray-200">
              <div className="w-full text-center py-2 rounded-lg text-sm font-medium bg-red-50 text-red-700">
                This request was rejected
              </div>
            </div>
          )}
        </ModalShell>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
          >
            <X size={22} className="text-white" />
          </button>
          <img
            src={lightboxUrl}
            alt="Verification document"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
