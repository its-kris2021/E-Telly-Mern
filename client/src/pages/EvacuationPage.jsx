import { useState, useEffect, useCallback, useRef } from "react";
import {
  Settings,
  Users,
  X,
  Check,
  RotateCcw,
  ChevronDown,
  Loader2,
  Plus,
  Phone,
  WifiOff,
  Trash2,
} from "lucide-react";
import ModalShell from "../components/ui/ModalShell";
import { connectSocket } from "../utils/socket";
import buildingImg from "../images/building.webp";
import LocationPicker from "../components/alerts/LocationPicker/LocationPicker";
import { getUserRole, getAssignedBarangay } from "../config/roleModules";

// ── Facility image map ────────────────────────────────────────────────────────
const FACILITY_IMAGES = {
  school: buildingImg,
  court: buildingImg,
  hall: buildingImg,
  daycare: buildingImg,
  clubhouse: buildingImg,
  default: buildingImg,
};

function getFacilityImage(centerName = "") {
  const n = centerName.toLowerCase();
  if (n.includes("school")) return FACILITY_IMAGES.school;
  if (n.includes("court")) return FACILITY_IMAGES.court;
  if (n.includes("hall") || n.includes("covered court"))
    return FACILITY_IMAGES.hall;
  if (n.includes("daycare")) return FACILITY_IMAGES.daycare;
  if (n.includes("clubhouse")) return FACILITY_IMAGES.clubhouse;
  return FACILITY_IMAGES.default;
}

// ── Barangay list with emergency hotlines ─────────────────────────────────────
const BARANGAYS = [
  {
    value: "bagongnayon",
    label: "Brgy. Bagong Nayon",
    hotlines: ["0945-624-8906", "0962-391-2390"],
  },
  {
    value: "beverlyhills",
    label: "Brgy. Beverly Hills",
    hotlines: ["0930-027-6922", "8518-2988", "0966-661-4839"],
  },
  { value: "calawis", label: "Brgy. Calawis", hotlines: ["0994-833-9165"] },
  {
    value: "cupang",
    label: "Brgy. Cupang",
    hotlines: [
      "0968-491-8172",
      "0910-524-9816",
      "0953-669-4295",
      "682-4946",
      "682-4837",
    ],
  },
  {
    value: "dalig",
    label: "Brgy. Dalig",
    hotlines: ["0968-491-8172", "0910-524-9816"],
  },
  {
    value: "delapaz",
    label: "Brgy. Dela Paz",
    hotlines: ["8260-0182", "0960-604-4446"],
  },
  { value: "inarawan", label: "Brgy. Inarawan", hotlines: ["0956-084-5977"] },
  {
    value: "mambugan",
    label: "Brgy. Mambugan",
    hotlines: ["0928-776-7525", "0998-475-1517"],
  },
  {
    value: "mayamot",
    label: "Brgy. Mayamot",
    hotlines: [
      "0918-288-7373",
      "0939-811-1094",
      "8470-6121",
      "8470-7935",
      "8880-4373",
      "8470-8924",
    ],
  },
  {
    value: "muntindilaw",
    label: "Brgy. Muntindilaw",
    hotlines: ["8463-0534", "0917-515-1764"],
  },
  {
    value: "sanisidro",
    label: "Brgy. San Isidro",
    hotlines: ["0933-829-7656", "0933-815-9319"],
  },
  {
    value: "sanjose",
    label: "Brgy. San Jose",
    hotlines: ["0966-448-6020", "0915-388-9567", "8818-4641"],
  },
  {
    value: "sanjuan",
    label: "Brgy. San Juan",
    hotlines: ["0968-602-8496", "8296-0453"],
  },
  {
    value: "sanluis",
    label: "Brgy. San Luis",
    hotlines: [
      "0956-442-2732",
      "0967-291-4584",
      "0935-532-5076",
      "0922-420-3099",
      "8696-7370",
    ],
  },
  {
    value: "sanroque",
    label: "Brgy. San Roque",
    hotlines: ["0945-624-8906", "0962-391-2390"],
  },
  {
    value: "santacruz",
    label: "Brgy. Santa Cruz",
    hotlines: [
      "0927-687-5203",
      "0928-620-6373",
      "0951-301-2629",
      "0912-985-1208",
      "8534-1105",
    ],
  },
  { value: "private", label: "Private Centers", hotlines: [] },
];

// ── API helpers ───────────────────────────────────────────────────────────────
function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
  };
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: authHeaders() });
  if (res.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/login";
    throw new Error("Session expired");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Offline cache (per-barangay) ──────────────────────────────────────────────
// The centers payload is small, so a synchronous localStorage cache keeps the
// existing optimistic/socket flow simple while still serving data offline.
const cacheKeyFor = (brgy) => `evac-centers:${brgy}`;

function readCenterCache(brgy) {
  try {
    const raw = localStorage.getItem(cacheKeyFor(brgy));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.data)) return null;
    return parsed; // { data, cachedAt }
  } catch {
    return null;
  }
}

function writeCenterCache(brgy, data) {
  try {
    localStorage.setItem(
      cacheKeyFor(brgy),
      JSON.stringify({ data, cachedAt: Date.now() }),
    );
  } catch {
    // storage full / unavailable — non-critical
  }
}

// ── Status helpers ────────────────────────────────────────────────────────────
function statusOf(occupancy, capacity) {
  if (capacity <= 0)
    return {
      label: "Unknown",
      badge: "bg-gray-100 text-gray-600",
      bar: "bg-gray-300",
    };
  const p = occupancy / capacity;
  if (occupancy === 0)
    return {
      label: "Vacant",
      badge: "bg-gray-100 text-gray-600",
      bar: "bg-gray-300",
    };
  if (p >= 1)
    return {
      label: "Full",
      badge: "bg-red-50 text-red-600",
      bar: "bg-red-500",
    };
  if (p >= 0.8)
    return {
      label: "Near Full",
      badge: "bg-orange-50 text-orange-600",
      bar: "bg-orange-500",
    };
  return {
    label: "Active",
    badge: "bg-green-50 text-green-700",
    bar: "bg-green-500",
  };
}

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Edit modal ────────────────────────────────────────────────────────────────
function EditModal({
  center,
  onClose,
  onSaveCapacity,
  onReset,
  onToggleAvailability,
  capacityOnly = false,
}) {
  const [cap, setCap] = useState(String(center.capacity));
  const [isAvail, setIsAvail] = useState(center.available !== false);

  function submit() {
    const n = parseInt(cap, 10);
    if (!isNaN(n) && n > 0) onSaveCapacity(center._id, n);
  }

  function toggleAvailability() {
    const next = !isAvail;
    setIsAvail(next);
    onToggleAvailability(center._id, next);
  }

  return (
    <ModalShell onClose={onClose} size="sm">
      <div className="p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-bold text-gray-900">Edit Facility</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-5 leading-snug">{center.name}</p>

        {!capacityOnly && (
          <>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Availability
            </label>
            <button
              onClick={toggleAvailability}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm font-semibold transition-colors mb-5
                ${
                  isAvail
                    ? "bg-green-50 border-green-200 text-green-700"
                    : "bg-red-50 border-red-200 text-red-600"
                }`}
            >
              <span>
                {isAvail ? "Available — open to evacuees" : "Unavailable — closed"}
              </span>
              <div
                className={`relative w-10 h-5 rounded-full transition-colors ${isAvail ? "bg-green-500" : "bg-red-400"}`}
              >
                <div
                  className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${isAvail ? "left-5" : "left-0.5"}`}
                />
              </div>
            </button>
          </>
        )}

        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Total Capacity
        </label>
        <input
          type="number"
          min={1}
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 mb-5"
        />

        <div className="flex gap-2">
          <button
            onClick={submit}
            className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-red-700 transition-colors"
          >
            Save Changes
          </button>
          {!capacityOnly && (
            <button
              onClick={() => onReset(center._id)}
              title="Reset occupancy to 0"
              className="px-4 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1.5"
            >
              <RotateCcw size={13} /> Reset
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

// ── Create modal ──────────────────────────────────────────────────────────────
function CreateModal({ currentBarangay, onClose, onCreate }) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [lat, setLat] = useState(null);
  const [lng, setLng] = useState(null);
  const [barangay, setBarangay] = useState(currentBarangay);
  const [cap, setCap] = useState("100");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!name.trim() || !location.trim()) {
      setErr("Name and location are required.");
      return;
    }
    const n = parseInt(cap, 10);
    if (isNaN(n) || n < 1) {
      setErr("Capacity must be at least 1.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      await onCreate({
        name: name.trim(),
        location: location.trim(),
        barangay,
        capacity: n,
        lat,
        lng,
      });
    } catch {
      setErr("Failed to create center. Try again.");
      setSaving(false);
    }
  }

  return (
    <ModalShell onClose={onClose} size="md">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-900">
            Add Evacuation Center
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        {err && <p className="text-xs text-red-600 mb-3">{err}</p>}

        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Name <span className="text-red-500">*</span>
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Barangay Covered Court"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 mb-3"
        />

        <div className="mb-3">
          <LocationPicker
            location={location}
            label="Location"
            onLocationChange={setLocation}
            onCoordinatesChange={(lt, lg) => {
              setLat(lt);
              setLng(lg);
            }}
            required
          />
        </div>

        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Barangay
        </label>
        <select
          value={barangay}
          onChange={(e) => setBarangay(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 mb-3"
        >
          {BARANGAYS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>

        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Capacity
        </label>
        <input
          type="number"
          min={1}
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 mb-5"
        />

        <button
          onClick={submit}
          disabled={saving || !name.trim() || !location.trim()}
          className="w-full bg-red-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Adding…" : "Add Center"}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Delete confirm modal ──────────────────────────────────────────────────────
function DeleteConfirmModal({ center, onClose, onConfirm, deleting }) {
  return (
    <ModalShell onClose={onClose} size="sm">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">Delete Center</h2>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      <div className="px-5 py-5 space-y-2">
        <p className="text-sm text-gray-700">
          Are you sure you want to delete this evacuation center?
        </p>
        <p className="text-sm font-semibold text-gray-900">{center.name}</p>
        <p className="text-xs text-gray-400 pt-1">
          This will permanently remove the center and its occupancy data. This
          action cannot be undone.
        </p>
      </div>

      <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={deleting}
          className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={deleting}
          className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function EvacuationPage() {
  // Barangay Official is locked to their own assignedBarangay — there is no
  // barangay switcher for that role (server also force-scopes on this, see
  // GET /api/evacuation/centers).
  const isOfficial = getUserRole() === "barangay_official";
  const [barangay, setBarangay] = useState(
    isOfficial ? getAssignedBarangay() || "muntindilaw" : "muntindilaw",
  );
  const [centers, setCenters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [cachedAt, setCachedAt] = useState(null);
  const [editId, setEditId] = useState(null);
  const [inputId, setInputId] = useState(null);
  const [inputVal, setInputVal] = useState("");
  const [brgyOpen, setBrgyOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const brgyBtnRef = useRef(null);

  // Only one occupancy write per center may be in flight at a time — otherwise
  // the real-time socket echo for an earlier click can arrive after a later
  // click's optimistic update and briefly flash a stale number ("moving back
  // and forth") before the correct value settles.
  function markPending(id) {
    setPendingIds((prev) => new Set(prev).add(id));
  }
  function clearPending(id) {
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  // ── Fetch centers ───────────────────────────────────────────────────────────
  const fetchCenters = useCallback(async (brgy) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch(`/api/evacuation/centers?barangay=${brgy}`);
      setCenters(data);
      writeCenterCache(brgy, data);
      setIsOffline(false);
      setCachedAt(Date.now());
    } catch {
      // Network failed — fall back to cached centers if we have them.
      const cached = readCenterCache(brgy);
      if (cached) {
        setCenters(cached.data);
        setCachedAt(cached.cachedAt);
        setIsOffline(true);
        setError(null);
      } else {
        setError("Failed to load evacuation centers. Check your connection.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCenters(barangay);
  }, [barangay, fetchCenters]);

  // ── Real-time Socket.IO ─────────────────────────────────────────────────────
  useEffect(() => {
    const socket = connectSocket();

    function onUpdate({ center }) {
      setCenters((prev) =>
        prev.map((c) => (c._id === center._id ? { ...c, ...center } : c)),
      );
    }

    socket.on("evacuation_updated", onUpdate);

    function onDeleted({ centerId }) {
      setCenters((prev) => prev.filter((c) => c._id !== centerId));
    }

    socket.on("evacuation_center_deleted", onDeleted);
    return () => {
      socket.off("evacuation_updated", onUpdate);
      socket.off("evacuation_center_deleted", onDeleted);
    };
  }, [barangay]);

  // ── Online / offline status ─────────────────────────────────────────────────
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      fetchCenters(barangay);
    };
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [barangay, fetchCenters]);

  // ── Occupancy adjustment ────────────────────────────────────────────────────
  async function adjust(id, delta) {
    if (isOffline || pendingIds.has(id)) return;
    const c = centers.find((x) => x._id === id);
    if (!c) return;
    const next = Math.max(0, Math.min(c.capacity, c.occupancy + delta));
    if (next === c.occupancy) return;

    markPending(id);
    setCenters((prev) =>
      prev.map((x) => (x._id === id ? { ...x, occupancy: next } : x)),
    );

    try {
      await apiFetch(`/api/evacuation/centers/${id}/occupancy`, {
        method: "PUT",
        body: JSON.stringify({ occupancy: next }),
      });
    } catch {
      fetchCenters(barangay);
    } finally {
      clearPending(id);
    }
  }

  function openInput(id, current) {
    setInputId(id);
    setInputVal(String(current));
  }

  async function commitInput(id) {
    if (isOffline || pendingIds.has(id)) {
      setInputId(null);
      setInputVal("");
      return;
    }
    const n = parseInt(inputVal, 10);
    if (!isNaN(n)) {
      const c = centers.find((x) => x._id === id);
      const next = c ? Math.max(0, Math.min(c.capacity, n)) : n;

      markPending(id);
      setCenters((prev) =>
        prev.map((x) => (x._id === id ? { ...x, occupancy: next } : x)),
      );

      try {
        await apiFetch(`/api/evacuation/centers/${id}/occupancy`, {
          method: "PUT",
          body: JSON.stringify({ occupancy: next }),
        });
      } catch {
        fetchCenters(barangay);
      } finally {
        clearPending(id);
      }
    }
    setInputId(null);
    setInputVal("");
  }

  async function handleSaveCapacity(id, capacity) {
    if (isOffline) return;
    try {
      await apiFetch(`/api/evacuation/centers/${id}/capacity`, {
        method: "PUT",
        body: JSON.stringify({ capacity }),
      });
    } catch {
      fetchCenters(barangay);
    }
    setEditId(null);
  }

  async function handleReset(id) {
    if (isOffline) return;
    try {
      await apiFetch(`/api/evacuation/centers/${id}/reset`, { method: "POST" });
    } catch {
      fetchCenters(barangay);
    }
    setEditId(null);
  }

  async function handleToggleAvailability(id, available) {
    if (isOffline) return;
    setCenters((prev) =>
      prev.map((x) => (x._id === id ? { ...x, available } : x)),
    );
    try {
      await apiFetch(`/api/evacuation/centers/${id}/availability`, {
        method: "PUT",
        body: JSON.stringify({ available }),
      });
    } catch {
      fetchCenters(barangay);
    }
  }

  async function handleCreateCenter(data) {
    if (isOffline) return;
    const center = await apiFetch("/api/evacuation/centers", {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (center.barangay === barangay) {
      setCenters((prev) => [...prev, center]);
    }
    setCreateOpen(false);
  }

  async function handleDeleteCenter(id) {
    if (isOffline) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/evacuation/centers/${id}`, { method: "DELETE" });
      setCenters((prev) => prev.filter((c) => c._id !== id));
      setDeleteId(null);
    } catch {
      fetchCenters(barangay);
    } finally {
      setDeleting(false);
    }
  }

  // ── Derived stats ───────────────────────────────────────────────────────────
  const totalCap = centers.reduce((s, c) => s + c.capacity, 0);
  const totalOcc = centers.reduce((s, c) => s + c.occupancy, 0);
  const activeCount = centers.filter((c) => c.occupancy > 0).length;
  const vacantCount = centers.filter((c) => c.occupancy === 0).length;

  function sortPriority(c) {
    if (c.available === false) return 5;
    if (c.occupancy === 0 || c.capacity <= 0) return 4;
    const p = c.occupancy / c.capacity;
    if (p >= 1) return 3;
    if (p >= 0.8) return 2;
    return 1;
  }
  const sortedCenters = [...centers].sort(
    (a, b) => sortPriority(a) - sortPriority(b),
  );

  const editCenter = centers.find((c) => c._id === editId) ?? null;
  const deleteCenter = centers.find((c) => c._id === deleteId) ?? null;
  const brgyLabel =
    BARANGAYS.find((b) => b.value === barangay)?.label ?? barangay;
  const hotlines = BARANGAYS.find((b) => b.value === barangay)?.hotlines ?? [];

  // Evacuation module is CDRRMO-only for occupancy/reset/availability/create.
  // Barangay Official may additionally edit capacity only, for centers in
  // their own (locked) barangay — enforced server-side by PUT /centers/:id/capacity.
  const isAdmin = getUserRole() === "cdrrmo";
  const canEditCapacity = isAdmin || isOfficial;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Evacuation Centers
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Antipolo City — {brgyLabel}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 shrink-0">
          {isAdmin && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCreateOpen(true)}
                disabled={isOffline}
                className="flex items-center gap-1.5 bg-red-600 text-white rounded-xl px-4 py-2 text-sm font-semibold hover:bg-red-700 shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus size={14} />
                Add Center
              </button>
            </div>
          )}

          {/* Barangay selector — Barangay Official is locked to their own barangay */}
          {isOfficial ? (
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm">
              {brgyLabel}
            </div>
          ) : (
          <div className="relative">
            <button
              ref={brgyBtnRef}
              onClick={() => setBrgyOpen((o) => !o)}
              className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm font-semibold text-gray-700 hover:border-gray-300 shadow-sm transition-colors"
            >
              {brgyLabel}
              <ChevronDown
                size={14}
                className={`transition-transform ${brgyOpen ? "rotate-180" : ""}`}
              />
            </button>

            {brgyOpen &&
              (() => {
                const rect = brgyBtnRef.current?.getBoundingClientRect();
                return (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setBrgyOpen(false)}
                    />
                    <div
                      className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-lg overflow-y-auto max-h-72"
                      style={{
                        top: rect ? rect.bottom + 4 : 0,
                        right: rect ? window.innerWidth - rect.right : 0,
                        minWidth: rect ? rect.width : 160,
                        maxWidth: 240,
                      }}
                    >
                      {BARANGAYS.map((b) => (
                        <button
                          key={b.value}
                          onClick={() => {
                            setBarangay(b.value);
                            setBrgyOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2.5 text-sm transition-colors
                          ${
                            barangay === b.value
                              ? "bg-red-50 text-red-700 font-semibold"
                              : "text-gray-700 hover:bg-gray-50"
                          }`}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </>
                );
              })()}
          </div>
          )}
        </div>
      </div>

      {/* Offline banner */}
      {isOffline && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <WifiOff size={15} className="shrink-0" />
          <span className="flex-1">
            Offline — showing cached evacuation centers
            {cachedAt ? ` (last updated ${fmtTime(cachedAt)})` : ""}. Editing is
            disabled until you reconnect.
          </span>
        </div>
      )}

      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Total Capacity",
            value: totalCap.toLocaleString(),
            color: "text-gray-900",
          },
          {
            label: "Occupied",
            value: totalOcc.toLocaleString(),
            color: "text-blue-600",
          },
          {
            label: "Active Centers",
            value: activeCount,
            color: "text-green-600",
          },
          {
            label: "Vacant Centers",
            value: vacantCount,
            color: "text-gray-500",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-xl border border-gray-200 px-4 py-3"
          >
            <p className="text-xs text-gray-500 font-medium">{s.label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Emergency hotlines */}
      {hotlines.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3">
          <Phone size={15} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-red-700 mb-1.5">
              Emergency Hotlines — {brgyLabel}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {hotlines.map((h) => (
                <span key={h} className="text-xs font-medium text-red-700">
                  {h}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-500">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm">Loading centers…</span>
        </div>
      )}

      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Center cards */}
      {!loading && !error && (
        <div className="space-y-3">
          {sortedCenters.map((c) => {
            const s = statusOf(c.occupancy, c.capacity);
            const p =
              c.capacity > 0
                ? Math.min(100, Math.round((c.occupancy / c.capacity) * 100))
                : 0;
            const isEditing = inputId === c._id;
            const unavailable = c.available === false;

            return (
              <div
                key={c._id}
                className={`rounded-xl border transition-all p-4
                  ${
                    unavailable
                      ? "bg-gray-50 border-gray-200"
                      : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm"
                  }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-14 h-14 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                    <img
                      src={c.imageUrl || getFacilityImage(c.name)}
                      alt={c.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.target.src = getFacilityImage(c.name);
                      }}
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-0.5">
                      <div className="min-w-0">
                        <h2 className="text-sm font-semibold text-gray-900 leading-snug">
                          {c.name}
                        </h2>
                        <p className="text-xs text-gray-500">{c.location}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {unavailable ? (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                            Unavailable
                          </span>
                        ) : (
                          <span
                            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${s.badge}`}
                          >
                            {s.label}
                          </span>
                        )}
                        {canEditCapacity && (
                          <button
                            onClick={() => setEditId(c._id)}
                            disabled={isOffline}
                            className="text-gray-300 hover:text-gray-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Settings size={15} />
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            onClick={() => setDeleteId(c._id)}
                            disabled={isOffline}
                            title="Delete center"
                            className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-2.5 mb-2">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] text-gray-500">
                          Occupancy
                        </span>
                        <span className="text-[10px] text-gray-500 font-semibold">
                          {p}%
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${s.bar}`}
                          style={{ width: `${p}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between flex-wrap gap-y-1">
                      <div className="flex items-center gap-1.5">
                        <Users size={12} className="text-gray-400 shrink-0" />
                        <span className="text-xs text-gray-500">Evacuees:</span>

                        {isAdmin ? (
                          <>
                            <button
                              onClick={() => adjust(c._id, -1)}
                              disabled={isOffline || c.occupancy <= 0 || pendingIds.has(c._id)}
                              className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors leading-none"
                            >
                              −
                            </button>

                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  max={c.capacity}
                                  value={inputVal}
                                  autoFocus
                                  onChange={(e) => setInputVal(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitInput(c._id);
                                    if (e.key === "Escape") {
                                      setInputId(null);
                                      setInputVal("");
                                    }
                                  }}
                                  className="w-16 text-center text-sm font-bold border border-blue-400 rounded-md px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                />
                                <button
                                  onClick={() => commitInput(c._id)}
                                  className="text-green-600 hover:text-green-700"
                                >
                                  <Check size={14} />
                                </button>
                                <button
                                  onClick={() => {
                                    setInputId(null);
                                    setInputVal("");
                                  }}
                                  className="text-gray-400 hover:text-gray-600"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => openInput(c._id, c.occupancy)}
                                disabled={isOffline || pendingIds.has(c._id)}
                                title={
                                  isOffline
                                    ? "Editing disabled while offline"
                                    : "Click to type a number"
                                }
                                className="text-sm font-bold text-gray-800 hover:text-blue-600 hover:underline min-w-[2rem] text-center disabled:no-underline disabled:text-gray-500 disabled:cursor-not-allowed"
                              >
                                {c.occupancy}
                              </button>
                            )}

                            <span className="text-xs text-gray-500 font-medium">
                              / {c.capacity}
                            </span>

                            <button
                              onClick={() => adjust(c._id, +1)}
                              disabled={isOffline || c.occupancy >= c.capacity || pendingIds.has(c._id)}
                              className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors leading-none"
                            >
                              +
                            </button>
                          </>
                        ) : (
                          <span className="text-sm font-bold text-gray-800">
                            {c.occupancy}{" "}
                            <span className="text-xs text-gray-500 font-medium">
                              / {c.capacity}
                            </span>
                          </span>
                        )}
                      </div>

                      <span className="text-[10px] text-gray-500">
                        {c.updatedAt
                          ? `Updated ${fmtTime(c.updatedAt)}`
                          : "Not yet updated"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit modal */}
      {editCenter && (
        <EditModal
          center={editCenter}
          onClose={() => setEditId(null)}
          onSaveCapacity={handleSaveCapacity}
          onReset={handleReset}
          onToggleAvailability={handleToggleAvailability}
          capacityOnly={!isAdmin}
        />
      )}

      {/* Create modal — admin only */}
      {createOpen && (
        <CreateModal
          currentBarangay={barangay}
          onClose={() => setCreateOpen(false)}
          onCreate={handleCreateCenter}
        />
      )}

      {/* Delete confirm modal — admin only */}
      {deleteCenter && (
        <DeleteConfirmModal
          center={deleteCenter}
          onClose={() => setDeleteId(null)}
          onConfirm={() => handleDeleteCenter(deleteCenter._id)}
          deleting={deleting}
        />
      )}
    </div>
  );
}
