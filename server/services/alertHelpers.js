import mongoose from "mongoose";
import Alert from "../models/Alert.js";
import { sendAdminNotification } from "../routes/push.js";
import { sendFCMToBarangays } from "./fcm.js";
import { signAlert } from "./alertSigning.js";

export function toDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function toHourKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${d.getHours()}`;
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const SEVERITY_PREFIX = {
  evacuate: "🔴 EVACUATE",
  critical: "🔴 Critical Alert",
  warning:  "⚠️ Warning",
  watch:    "👁️ Watch",
  advisory: "ℹ️ Advisory",
};

// matchExtra narrows which existing document counts as "the same alert"
// beyond _dedupeKey+isActive — see upsertAiAlert below, which uses this to
// stop a later prediction cycle from silently overwriting a human-reviewed
// alert or relabeling one onto a different model version. Defaults to {} so
// upsertSystemAlert's behavior is completely unchanged.
export async function upsertAlert({ _dedupeKey, source, ...alertData }, matchExtra = {}) {
  const matchQuery = { _dedupeKey, isActive: true, ...matchExtra };

  // Signing needs the alert's final _id and createdAt, which for an
  // upsert normally aren't known until after the write (a brand-new _id
  // is assigned by MongoDB on insert). Look up whether this is an update
  // or a genuine insert first so signAlert() can be called with the real
  // values before the write happens, exactly like the pre-generated-_id
  // pattern used in routes/alerts.js and index.js's Alert.create() calls.
  const existing = await Alert.findOne(
    matchQuery,
    { _id: 1, createdAt: 1 },
  );
  const _id = existing?._id ?? new mongoose.Types.ObjectId();
  const createdAt = existing?.createdAt ?? new Date();
  const updatedAt = new Date();

  const signed = signAlert({ ...alertData, source, _id, createdAt, isActive: true });

  const result = await Alert.updateOne(
    matchQuery,
    {
      $set: {
        ...alertData,
        source,
        _dedupeKey,
        updatedAt,
        ...(signed ? { signature: signed.signature, keyId: signed.keyId } : {}),
      },
      // _id must only ever be set on insert — MongoDB rejects changing an
      // existing document's _id via $set.
      $setOnInsert: { _id, createdAt, isActive: true },
    },
    // setDefaultsOnInsert ensures schema defaults (e.g. Alert.confirmedOutcome
    // = "unconfirmed") are actually applied on a brand-new upsert — a raw
    // updateOne upsert otherwise only writes the fields listed in $set/$setOnInsert.
    { upsert: true, setDefaultsOnInsert: true },
  );
  return result.upsertedCount > 0; // true = brand-new alert
}

export async function upsertSystemAlert(data) {
  const isNew = await upsertAlert({ ...data, source: "system" });

  if (isNew) {
    const prefix = SEVERITY_PREFIX[data.severity] ?? "⚠️ Alert";
    const pushPayload = {
      title:  `${prefix}: ${data.title}`,
      body:   data.description.slice(0, 100),
      url:    "/alerts",
      tag:    `system-${data._dedupeKey}`,
      urgent: data.severity === "evacuate" || data.severity === "critical",
    };
    // These are always single-barangay alerts (see floodAlerts.js/landslideAlerts.js
    // callers) — scope the push so only that barangay's official/residents get it.
    const barangays = data.barangays ?? [];
    sendAdminNotification(pushPayload, barangays)
      .catch((err) => console.error("[Push] System alert admin push failed:", err.message));
    sendFCMToBarangays(pushPayload, barangays)
      .catch((err) => console.error("[Push] System alert FCM push failed:", err.message));
  }

  return isNew;
}

// AI-predicted hazards. Deliberately not marked urgent (even at high
// confidence) and uses softer copy than upsertSystemAlert — these are
// advisory/unconfirmed by definition, and should never carry the same
// implied authority as a PAGASA-threshold-triggered evacuation alert.
//
// matchExtra: { confirmedOutcome: "unconfirmed", modelVersion: data.modelVersion }
// — predictionEngine.js's cron can re-score the same barangay/hazard/day many
// times (every ~30 min). A later cycle only updates THIS SAME alert document
// in place when it is still (a) unconfirmed and (b) scored by the same model
// version as before. If an admin already confirmed/rejected it, or a retrain
// promoted a different model version since it was created, this creates a
// NEW alert instead of silently overwriting the existing one's modelVersion/
// confidence — so a human-reviewed outcome and its original model
// attribution can never be corrupted by a later re-scoring cycle.
//
// Trade-off, deliberate and documented rather than hidden: a stale,
// unreviewed, now-superseded alert from an older model version is left
// exactly as it was (not deleted or deactivated) until it naturally expires
// via expiresAt — so two active AI alerts for the same barangay/hazard can
// briefly coexist across a same-day retrain, or after one is reviewed while
// still re-firing. This is the cost of refusing to silently relabel
// attribution; the alternative (skip re-scoring entirely once reviewed or
// once the version changes) would lose the newer model's signal until the
// next calendar day instead.
export async function upsertAiAlert(data) {
  const isNew = await upsertAlert(
    { ...data, source: "ai" },
    { confirmedOutcome: "unconfirmed", modelVersion: data.modelVersion },
  );

  if (isNew) {
    const barangayName = data.barangays?.[0] ?? "your area";
    const pushPayload = {
      title: `AI Prediction: ${data.title}`,
      body: `Elevated ${data.type} risk detected in ${barangayName} — not yet confirmed. Tap for details.`,
      url: "/hazard-map",
      tag: `ai-${data._dedupeKey}`,
      urgent: false,
    };
    const barangays = data.barangays ?? [];
    sendAdminNotification(pushPayload, barangays)
      .catch((err) => console.error("[Push] AI alert admin push failed:", err.message));
    sendFCMToBarangays(pushPayload, barangays)
      .catch((err) => console.error("[Push] AI alert FCM push failed:", err.message));
  }

  return isNew;
}
