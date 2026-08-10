import express from "express";
import webpush from "web-push";
import PushSubscription from "../models/PushSubscription.js";
import FcmToken from "../models/FcmToken.js";
import User from "../models/user.js";
import { protect } from "../middleware/auth.js";
import { OPS_ROLES } from "../config/roles.js";
import { sendFCMToAll, sendFCMToUser } from "../services/fcm.js";

const router = express.Router();

// Called lazily so env vars are available after dotenv.config() runs in index.js
function initVapid() {
  webpush.setVapidDetails(
    process.env.VAPID_MAILTO,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

// POST /api/push/subscribe — save a browser push subscription
router.post("/subscribe", protect, async (req, res) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: "Invalid subscription object" });
    }
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      { endpoint, keys, userId: req.user.id },
      { upsert: true, new: true },
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to save subscription" });
  }
});

// DELETE /api/push/unsubscribe — remove a subscription
router.delete("/unsubscribe", protect, async (req, res) => {
  try {
    const { endpoint } = req.body;
    await PushSubscription.deleteOne({ endpoint });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to remove subscription" });
  }
});

// POST /api/push/fcm-subscribe — register a Flutter FCM device token
router.post("/fcm-subscribe", protect, async (req, res) => {
  try {
    const { token, platform } = req.body;
    if (!token || !["android", "ios"].includes(platform)) {
      return res.status(400).json({ error: "token and platform (android|ios) are required" });
    }
    await FcmToken.findOneAndUpdate(
      { token },
      { token, userId: req.user.id, platform, updatedAt: new Date() },
      { upsert: true, new: true },
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[FCM] Subscribe error:", err.message);
    res.status(500).json({ error: "Failed to save FCM token" });
  }
});

// DELETE /api/push/fcm-unsubscribe — remove a Flutter FCM device token on logout
router.delete("/fcm-unsubscribe", protect, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "token is required" });
    await FcmToken.deleteOne({ token });
    res.json({ success: true });
  } catch (err) {
    console.error("[FCM] Unsubscribe error:", err.message);
    res.status(500).json({ error: "Failed to remove FCM token" });
  }
});
// Send a push notification to every stored subscription
export async function sendPushToAll(payload) {
  initVapid();
  const subs = await PushSubscription.find();
  console.log(`[Push] Sending to ${subs.length} subscriber(s)`);
  await Promise.allSettled(
    subs.map((sub) =>
      webpush
        .sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload),
        )
        .then(() => console.log("[Push] Sent OK →", sub.endpoint.slice(0, 60)))
        .catch(async (err) => {
          console.error(
            "[Push] Failed →",
            err.statusCode,
            err.body ?? err.message,
          );
          if (err.statusCode === 410) {
            await PushSubscription.deleteOne({ endpoint: sub.endpoint });
          }
        }),
    ),
  );
}

// Unified sender — VAPID (web admins) + FCM (mobile residents).
// Use for hazard alerts and official CDRRMO announcements.
export async function sendNotificationToAll(payload) {
  const [vapidResult, fcmResult] = await Promise.allSettled([
    sendPushToAll(payload),
    sendFCMToAll(payload),
  ]);
  if (vapidResult.status === "rejected") {
    console.error("[Notify] VAPID channel failed:", vapidResult.reason?.message);
  }
  if (fcmResult.status === "rejected") {
    console.error("[Notify] FCM channel failed:", fcmResult.reason?.message);
  }
}

// User-targeted sender — VAPID (web/PWA) + FCM (mobile) for one specific user.
export async function sendPushToUser(userId, payload) {
  initVapid();
  const subs = await PushSubscription.find({ userId });
  await Promise.allSettled([
    ...subs.map((sub) =>
      webpush
        .sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload))
        .catch(async (err) => {
          if (err.statusCode === 410) await PushSubscription.deleteOne({ endpoint: sub.endpoint });
        })
    ),
    sendFCMToUser(userId, payload).catch((err) => console.error("[Push] sendFCMToUser failed:", err.message)),
  ]);
}

// Ops-only sender — VAPID only, no FCM.
// Sends exclusively to CDRRMO/barangay_official subscribers so residents
// (and System Admin, which has no disaster-ops role) are not spammed with
// operational CDRRMO tasks.
export async function sendAdminNotification(payload) {
  initVapid();
  const adminUsers = await User.find({
    role: { $in: OPS_ROLES },
  }).select("_id").lean();
  const adminIds = adminUsers.map((u) => u._id);
  const subs = await PushSubscription.find({ userId: { $in: adminIds } });
  console.log(`[Push] Sending admin notification to ${subs.length} admin subscriber(s)`);
  await Promise.allSettled(
    subs.map((sub) =>
      webpush
        .sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload),
        )
        .then(() => console.log("[Push] Admin sent OK →", sub.endpoint.slice(0, 60)))
        .catch(async (err) => {
          console.error("[Push] Admin failed →", err.statusCode, err.body ?? err.message);
          if (err.statusCode === 410) {
            await PushSubscription.deleteOne({ endpoint: sub.endpoint });
          }
        }),
    ),
  );
}

export default router;
