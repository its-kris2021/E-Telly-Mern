import admin from "firebase-admin";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import FcmToken from "../models/FcmToken.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Absolute path to the service account file — works regardless of cwd
const SERVICE_ACCOUNT_PATH = join(__dirname, "../config/firebase-service-account.json");

let initialized = false;

export function initFirebase() {
  if (initialized) return;
  initialized = true;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    // Heroku: service account JSON stored as base64 env var
    const serviceAccount = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, "base64").toString("utf8"),
    );
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } else {
    // Local dev: read JSON file using absolute path derived from this file's location
    const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, "utf8"));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
}

function urlToRoute(url) {
  if (!url) return "home";
  if (url.includes("/alerts"))    return "alerts";
  if (url.includes("/reports"))   return "reports";
  if (url.includes("/community")) return "community";
  if (url.includes("/resources")) return "resources";
  if (url.includes("/chats"))     return "chats";
  return "home";
}

function buildMulticastMessage(payload, tokens) {
  const urgent = payload.urgent ?? false;
  return {
    notification: {
      title: payload.title,
      body:  payload.body,
    },
    android: {
      priority: urgent ? "high" : "normal",
      notification: {
        channelId:            "etelly_alerts",
        priority:             urgent ? "max" : "default",
        defaultSound:         true,
        defaultVibrateTimings: true,
      },
    },
    apns: {
      headers: { "apns-priority": urgent ? "10" : "5" },
      payload: {
        aps: {
          sound:           "default",
          contentAvailable: true,
          badge:            1,
        },
      },
    },
    data: {
      url:    payload.url    ?? "/alerts",
      tag:    payload.tag    ?? "alert",
      urgent: String(urgent),
      route:  urlToRoute(payload.url),
      // FCM data payload values must all be strings — callers (e.g. the
      // chat push in index.js) pass extra fields like senderId here for
      // deep-linking that the base url/tag/urgent/route shape doesn't cover.
      ...(payload.data ?? {}),
    },
    tokens,
  };
}

export async function sendFCMToUser(userId, payload) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !existsSync(SERVICE_ACCOUNT_PATH)) {
    console.log(`[FCM] No Firebase credentials configured — skipping push to user ${userId}`);
    return;
  }
  initFirebase();

  const tokenDocs = await FcmToken.find({ userId }, "token").lean();
  if (!tokenDocs.length) {
    console.log(`[FCM] No registered token(s) for user ${userId} — skipping`);
    return;
  }

  const tokens = tokenDocs.map((d) => d.token);
  const message = buildMulticastMessage(payload, tokens);
  const response = await admin.messaging().sendEachForMulticast(message);
  console.log(`[FCM] Sent to user ${userId}: ${response.successCount} succeeded, ${response.failureCount} failed`);

  const toDelete = [];
  response.responses.forEach((r, idx) => {
    if (!r.success) {
      const code = r.error?.code;
      console.error("[FCM] Send to user failed →", tokens[idx].slice(0, 20), code);
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        toDelete.push(tokens[idx]);
      }
    }
  });
  if (toDelete.length) await FcmToken.deleteMany({ token: { $in: toDelete } });
}

export async function sendFCMToAll(payload) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !existsSync(SERVICE_ACCOUNT_PATH)) {
    console.log("[FCM] No Firebase credentials configured — skipping");
    return;
  }

  initFirebase();

  const tokenDocs = await FcmToken.find({}, "token").lean();
  if (!tokenDocs.length) {
    console.log("[FCM] No registered tokens — skipping");
    return;
  }

  const tokens = tokenDocs.map((d) => d.token);
  console.log(`[FCM] Sending to ${tokens.length} token(s)`);

  const BATCH_SIZE = 500;
  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch   = tokens.slice(i, i + BATCH_SIZE);
    const message = buildMulticastMessage(payload, batch);

    const response = await admin.messaging().sendEachForMulticast(message);

    const toDelete = [];
    response.responses.forEach((r, idx) => {
      if (!r.success) {
        const code = r.error?.code;
        if (
          code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token"
        ) {
          toDelete.push(batch[idx]);
        }
        console.error("[FCM] Send failed →", batch[idx].slice(0, 20), code);
      }
    });

    if (toDelete.length) {
      await FcmToken.deleteMany({ token: { $in: toDelete } });
      console.log(`[FCM] Cleaned up ${toDelete.length} stale token(s)`);
    }
  }
}
