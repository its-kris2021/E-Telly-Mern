import { useState, useEffect, useCallback, useRef } from "react";

const DB_NAME = "etelly-offline-queue";
const DB_VERSION = 1;
const STORE = "pending-alerts";
const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? `http://${window.location.hostname}:5000`);

let dbPromise = null;
const getDB = () => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
};

const idbGetAll = async () => {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
};

const idbAdd = async (item) => {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).add(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

const idbDelete = async (id) => {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

/**
 * useOfflineAlertQueue — saves alert form payloads to IndexedDB when offline
 * and automatically POSTs them to /api/alerts when connectivity is restored.
 *
 * @param {Function} onSynced — called after at least one queued alert is synced
 */
export function useOfflineAlertQueue(onSynced) {
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  // Use refs so the flush callback doesn't need them as deps (avoids re-registering
  // the online listener every time syncing flips).
  const syncingRef = useRef(false);
  const onSyncedRef = useRef(onSynced);
  useEffect(() => { onSyncedRef.current = onSynced; });

  const refreshCount = useCallback(async () => {
    try {
      const items = await idbGetAll();
      setPendingCount(items.length);
    } catch {
      // non-critical
    }
  }, []);

  const enqueue = useCallback(async (payload) => {
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      payload,
      queuedAt: Date.now(),
      token: localStorage.getItem("token") ?? "",
    };
    await idbAdd(item);
    await refreshCount();
  }, [refreshCount]);

  const flush = useCallback(async () => {
    if (syncingRef.current) return;
    const items = await idbGetAll();
    if (items.length === 0) return;

    syncingRef.current = true;
    setSyncing(true);
    let syncedAny = false;

    for (const item of items) {
      try {
        const res = await fetch(`${API_BASE}/api/alerts`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${item.token}`,
          },
          body: JSON.stringify(item.payload),
        });

        if (res.ok) {
          await idbDelete(item.id);
          syncedAny = true;
        } else if (res.status === 401 || res.status === 403) {
          // Token expired — remove rather than retry forever
          await idbDelete(item.id);
        }
        // Other server errors: leave in queue for next attempt
      } catch {
        // Network still down — stop and try again on next online event
        break;
      }
    }

    syncingRef.current = false;
    setSyncing(false);
    await refreshCount();
    if (syncedAny) onSyncedRef.current?.();
  }, [refreshCount]);

  useEffect(() => {
    refreshCount();
  }, [refreshCount]);

  // Auto-flush whenever the device comes back online
  useEffect(() => {
    const handle = () => flush();
    window.addEventListener("online", handle);
    return () => window.removeEventListener("online", handle);
  }, [flush]);

  return { pendingCount, syncing, enqueue, flush };
}
