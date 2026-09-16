import { useState, useEffect } from "react";

const API_BASE       = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? `http://${window.location.hostname}:5000`);
const VAPID_PUB_KEY  = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64     = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw     = window.atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function usePushNotifications() {
  const isSupported = "serviceWorker" in navigator && "PushManager" in window;

  const [permission,  setPermission]  = useState(() =>
    isSupported ? Notification.permission : "denied"
  );
  const [subscribed,  setSubscribed]  = useState(false);
  const [loading,     setLoading]     = useState(false);

  // Check existing subscription on mount
  useEffect(() => {
    if (!isSupported) return;
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => setSubscribed(!!sub))
    );
  }, [isSupported]);

  const subscribe = async () => {
    if (!isSupported || !VAPID_PUB_KEY) return;
    setLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") return;

      const swTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Service worker not ready — try refreshing the page")), 8000)
      );
      const reg = await Promise.race([navigator.serviceWorker.ready, swTimeout]);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUB_KEY),
      });

      const token = localStorage.getItem("token") ?? "";
      await fetch(`${API_BASE}/api/push/subscribe`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify(sub.toJSON()),
      });

      setSubscribed(true);
    } catch (err) {
      console.error("Push subscribe error:", err);
    } finally {
      setLoading(false);
    }
  };

  const unsubscribe = async () => {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const token = localStorage.getItem("token") ?? "";
        await fetch(`${API_BASE}/api/push/unsubscribe`, {
          method:  "DELETE",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body:    JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (err) {
      console.error("Push unsubscribe error:", err);
    } finally {
      setLoading(false);
    }
  };

  return { permission, subscribed, loading, isSupported, subscribe, unsubscribe };
}
