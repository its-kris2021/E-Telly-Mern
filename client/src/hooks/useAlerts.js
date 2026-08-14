import { useState, useEffect, useCallback, useRef } from "react";
import { connectSocket } from "../utils/socket";

const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? "http://localhost:5000");
const REFRESH_COOLDOWN = 10; // seconds — anti-spam only, not rate-limiting

// rescue type always sorts first, then by severity
const SEVERITY_ORDER = { evacuate: 0, critical: 1, warning: 2, watch: 3 };

// ── IndexedDB alert cache ─────────────────────────────────────────────────────
const IDB_NAME  = "etelly-alerts-cache";
const IDB_STORE = "alerts";

function openAlertsDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess  = (e) => resolve(e.target.result);
    req.onerror    = ()  => reject();
  });
}

async function readAlertsCache() {
  try {
    const db = await openAlertsDB();
    return await new Promise((resolve) => {
      const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get("latest");
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = () => resolve(null);
    });
  } catch { return null; }
}

async function writeAlertsCache(alerts) {
  try {
    const db = await openAlertsDB();
    await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put({ alerts, cachedAt: Date.now() }, "latest");
      tx.oncomplete = resolve;
      tx.onerror    = resolve;
    });
  } catch { /* non-critical */ }
}

// ── Exports ───────────────────────────────────────────────────────────────────
export const SOURCE_CONFIG = {
  system: {
    label: "System",
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
  },
  CDRRMO: {
    label: "CDRRMO",
    bg: "bg-green-50",
    text: "text-green-700",
    border: "border-green-200",
  },
  Barangay: {
    label: "Barangay",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
  },
  USGS: {
    label: "USGS",
    bg: "bg-purple-50",
    text: "text-purple-700",
    border: "border-purple-200",
  },
  PAGASA: {
    label: "PAGASA",
    bg: "bg-sky-50",
    text: "text-sky-700",
    border: "border-sky-200",
  },
  GDACS: {
    label: "GDACS",
    bg: "bg-sky-50",
    text: "text-sky-700",
    border: "border-sky-200",
  },
  NDRRMC: {
    label: "NDRRMC",
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
  },
  OCD: {
    label: "OCD",
    bg: "bg-orange-50",
    text: "text-orange-700",
    border: "border-orange-200",
  },
};

export const SEVERITY_CONFIG = {
  evacuate: {
    label: "EVACUATE",
    bg: "bg-red-600",
    text: "text-white",
    border: "border-red-600",
    leftBorder: "border-red-600",
    icon: "🚨",
    description: "Leave now. It is dangerous to stay. Go to the nearest evacuation center right away.",
  },
  critical: {
    label: "Critical",
    bg: "bg-red-100",
    text: "text-red-700",
    border: "border-red-300",
    leftBorder: "border-red-500",
    icon: "🔴",
  },
  warning: {
    label: "Warning",
    bg: "bg-amber-100",
    text: "text-amber-700",
    border: "border-amber-300",
    leftBorder: "border-amber-500",
    icon: "⚡",
    description: "Get ready. A hazard is happening or about to happen. Prepare to act.",
  },
  watch: {
    label: "Watch",
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
    leftBorder: "border-blue-400",
    icon: "👁",
    description: "Be alert. A hazard might happen. Stay updated — no need to move yet.",
  },
};

export const RESCUE_CONFIG = {
  label: "RESCUE",
  bg: "bg-red-600",
  text: "text-white",
  border: "border-red-600",
  leftBorder: "border-red-600",
};

export function useAlerts() {
  const [alerts,       setAlerts]       = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [isStale,      setIsStale]      = useState(false);
  const [lastFetched,  setLastFetched]  = useState(null);
  const [cooldownSecs, setCooldownSecs] = useState(0);
  const cooldownRef = useRef(null);

  function sortAlerts(raw) {
    return (raw ?? []).slice().sort((a, b) => {
      if (a.type === "rescue" && b.type !== "rescue") return -1;
      if (b.type === "rescue" && a.type !== "rescue") return  1;
      const diff = (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
      if (diff !== 0) return diff;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/alerts`);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();

      const sorted = sortAlerts(data.alerts);
      setAlerts(sorted);
      setError(null);
      setIsStale(false);
      setLastFetched(new Date());
      writeAlertsCache(sorted); // fire-and-forget
    } catch (err) {
      // Network failed — try the local cache so the user still sees data
      const cached = await readAlertsCache();
      if (cached?.alerts?.length) {
        setAlerts(cached.alerts);
        setIsStale(true);
        setError(null);
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Show cached alerts immediately while the fresh fetch is in flight
    readAlertsCache().then((cached) => {
      if (cached?.alerts?.length) {
        setAlerts(cached.alerts);
        setIsStale(true);
        setLoading(false);
      }
    });

    fetchAlerts();

    // Real-time: socket events update instantly, no polling needed
    const socket = connectSocket();
    socket.on("new_alert",     fetchAlerts);
    socket.on("alert_updated", fetchAlerts);

    // Catch-up fetch: "connect" fires on the initial connection AND on every
    // reconnect, so this is how we pick up any new_alert/alert_updated
    // events that were emitted while the socket was disconnected.
    socket.on("connect", fetchAlerts);
    // Mark stale immediately on disconnect so the UI reflects the gap
    // while the socket works on reconnecting.
    const handleDisconnect = () => setIsStale(true);
    socket.on("disconnect", handleDisconnect);

    // Browser network recovery can precede/outlast the socket's own
    // reconnect handshake, so also catch up there.
    const handleOnline  = () => fetchAlerts();
    const handleOffline = () => setIsStale(true);
    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      socket.off("new_alert",     fetchAlerts);
      socket.off("alert_updated", fetchAlerts);
      socket.off("connect",       fetchAlerts);
      socket.off("disconnect",    handleDisconnect);
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [fetchAlerts]);

  const dismiss = useCallback(
    async (alertId) => {
      setAlerts((prev) => prev.filter((a) => a._id !== alertId));
      try {
        await fetch(`${API_BASE}/api/alerts/${alertId}/dismiss`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` },
        });
      } catch {
        fetchAlerts();
      }
    },
    [fetchAlerts],
  );

  const refresh = useCallback(() => {
    if (cooldownSecs > 0) return;
    setLoading(true);
    fetchAlerts();

    // Short anti-spam cooldown
    clearInterval(cooldownRef.current);
    setCooldownSecs(REFRESH_COOLDOWN);
    let remaining = REFRESH_COOLDOWN;
    cooldownRef.current = setInterval(() => {
      remaining -= 1;
      setCooldownSecs(remaining);
      if (remaining <= 0) clearInterval(cooldownRef.current);
    }, 1000);
  }, [fetchAlerts, cooldownSecs]);

  useEffect(() => () => clearInterval(cooldownRef.current), []);

  const counts = alerts.reduce(
    (acc, a) => {
      if (a.type === "rescue") acc.rescue = (acc.rescue ?? 0) + 1;
      else acc[a.severity] = (acc[a.severity] ?? 0) + 1;
      acc.total += 1;
      return acc;
    },
    { evacuate: 0, critical: 0, warning: 0, watch: 0, rescue: 0, total: 0 },
  );

  return { alerts, loading, error, isStale, lastFetched, dismiss, refresh, cooldownSecs, counts };
}
