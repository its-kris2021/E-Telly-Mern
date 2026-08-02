import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import ModalShell from "../ui/ModalShell";
import { SEVERITY_CONFIG } from "../../hooks/useAlerts";
import LocationPicker from "./LocationPicker/LocationPicker";

const INCIDENT_TYPES = [
  { value: "rescue", label: "Rescue", color: "#ef4444" },
  { value: "flood", label: "Flood", color: "#06b6d4" },
  { value: "fire", label: "Fire", color: "#dc2626" },
  { value: "earthquake", label: "Earthquake", color: "#f97316" },
  { value: "landslide", label: "Landslide", color: "#8b5cf6" },
  { value: "other", label: "Other", color: "#6b7280" },
];

const SEVERITIES = ["watch", "warning", "evacuate"];

export default function CreateAlertModal({ onClose, onCreated }) {
  const stored = localStorage.getItem("user");
  const userRole = stored ? JSON.parse(stored).role : "admin";
  const isAdmin = userRole === "admin";

  const defaultSource = isAdmin ? "CDRRMO" : "Barangay";

  const [form, setForm] = useState({
    source: defaultSource,
    type: "flood",
    severity: "warning",
    title: "",
    description: "",
    location: "",
    lat: null,
    lng: null,
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const isRescue = form.type === "rescue";

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.description.trim()) {
      setFormError("Title and description are required.");
      return;
    }
    if (!form.location.trim()) {
      setFormError(
        "Affected location is required. Search or pin a location on the map.",
      );
      return;
    }
    setFormError("");
    setSubmitting(true);
    try {
      const API_BASE = import.meta.env.PROD
        ? window.location.origin
        : (import.meta.env?.VITE_API_BASE ?? "http://localhost:5000");
      const res = await fetch(`${API_BASE}/api/alerts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
        },
        body: JSON.stringify({
          source: form.source,
          type: form.type,
          severity: isRescue ? "evacuate" : form.severity,
          title: form.title.trim(),
          description: form.description.trim(),
          location: form.location.trim(),
          barangays: [],
          lat: form.lat,
          lng: form.lng,
        }),
      });
      if (res.ok) {
        onCreated();
        onClose();
      } else {
        setFormError("Failed to create alert. Please try again.");
      }
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell onClose={onClose} size="lg" flex>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">
            Create Manual Alert
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100"
          >
            <X size={15} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          {/* Source */}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">
              Source
            </label>
            {isAdmin ? (
              <select
                value={form.source}
                onChange={(e) =>
                  setForm((f) => ({ ...f, source: e.target.value }))
                }
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="CDRRMO">CDRRMO</option>
                <option value="Barangay">Barangay</option>
              </select>
            ) : (
              <div className="w-full text-sm border border-gray-100 bg-gray-50 rounded-lg px-3 py-2 text-gray-500 font-medium">
                Barangay
              </div>
            )}
          </div>

          {/* Incident Type — color-coded button grid */}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1.5 block">
              Incident Type
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {INCIDENT_TYPES.map((t) => {
                const active = form.type === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, type: t.value }))}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold border transition-all
                      ${
                        active
                          ? "bg-gray-900 text-white border-gray-900 shadow-sm"
                          : "bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                      }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: active ? "white" : t.color }}
                    />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Severity — hidden for rescue */}
          {isRescue ? (
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1.5 block">
                Severity
              </label>
              <div className="flex items-center gap-2 px-3 py-2 bg-red-600 rounded-lg w-fit">
                <span className="text-xs font-bold text-white tracking-wide">
                  RESCUE
                </span>
              </div>
            </div>
          ) : (
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1.5 block">
                Severity
              </label>
              <div className="flex gap-2">
                {SEVERITIES.map((s) => {
                  const cfg = SEVERITY_CONFIG[s];
                  return (
                    <div key={s} className="relative flex-1 group">
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, severity: s }))}
                        className={`w-full py-1.5 rounded-lg text-xs font-semibold border transition-all
                          ${
                            form.severity === s
                              ? `${cfg.bg} ${cfg.text} ${cfg.border}`
                              : "bg-gray-50 text-gray-400 border-gray-200 hover:border-gray-300"
                          }`}
                      >
                        {cfg.label}
                      </button>

                      {/* Hover tooltip — explains what this severity means */}
                      <div
                        className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20 w-48
                                   rounded-lg bg-gray-900 text-white px-3 py-2 shadow-lg
                                   opacity-0 invisible group-hover:opacity-100 group-hover:visible
                                   transition-all pointer-events-none"
                      >
                        <p className="text-[11px] font-bold flex items-center gap-1">
                          <span>{cfg.icon}</span>
                          {cfg.label}
                        </p>
                        <p className="text-[11px] leading-snug text-gray-200 mt-0.5">
                          {cfg.description}
                        </p>
                        {/* pointer */}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 w-2 h-2 rotate-45 bg-gray-900" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) =>
                setForm((f) => ({ ...f, title: e.target.value }))
              }
              placeholder="e.g. Structure Fire — Sumulong Highway"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              rows={3}
              placeholder="Plain-language description for residents…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 text-gray-700 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all"
            />
          </div>

          {/* Location picker */}
          <LocationPicker
            location={form.location}
            onLocationChange={(loc) =>
              setForm((f) => ({ ...f, location: loc }))
            }
            onCoordinatesChange={(lat, lng) =>
              setForm((f) => ({ ...f, lat, lng }))
            }
            required
          />

          {formError && (
            <p className="text-xs text-red-500 flex items-center gap-1">
              <AlertTriangle size={11} /> {formError}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !form.title.trim()}
            className="px-5 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Creating…" : "Create Alert"}
          </button>
        </div>
    </ModalShell>
  );
}
