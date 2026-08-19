import mongoose from "mongoose";
import Alert from "../models/Alert.js";
import { sendNotificationToAll } from "../routes/push.js";
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

export async function upsertAlert({ _dedupeKey, source, ...alertData }) {
  // Signing needs the alert's final _id and createdAt, which for an
  // upsert normally aren't known until after the write (a brand-new _id
  // is assigned by MongoDB on insert). Look up whether this is an update
  // or a genuine insert first so signAlert() can be called with the real
  // values before the write happens, exactly like the pre-generated-_id
  // pattern used in routes/alerts.js and index.js's Alert.create() calls.
  const existing = await Alert.findOne(
    { _dedupeKey, isActive: true },
    { _id: 1, createdAt: 1 },
  );
  const _id = existing?._id ?? new mongoose.Types.ObjectId();
  const createdAt = existing?.createdAt ?? new Date();
  const updatedAt = new Date();

  const signed = signAlert({ ...alertData, source, _id, createdAt, isActive: true });

  const result = await Alert.updateOne(
    { _dedupeKey, isActive: true },
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
    sendNotificationToAll({
      title:  `${prefix}: ${data.title}`,
      body:   data.description.slice(0, 100),
      url:    "/alerts",
      tag:    `system-${data._dedupeKey}`,
      urgent: data.severity === "evacuate" || data.severity === "critical",
    }).catch((err) => console.error("[Push] System alert push failed:", err.message));
  }

  return isNew;
}

// AI-predicted hazards. Deliberately not marked urgent (even at high
// confidence) and uses softer copy than upsertSystemAlert — these are
// advisory/unconfirmed by definition, and should never carry the same
// implied authority as a PAGASA-threshold-triggered evacuation alert.
export async function upsertAiAlert(data) {
  const isNew = await upsertAlert({ ...data, source: "ai" });

  if (isNew) {
    const barangayName = data.barangays?.[0] ?? "your area";
    sendNotificationToAll({
      title: `AI Prediction: ${data.title}`,
      body: `Elevated ${data.type} risk detected in ${barangayName} — not yet confirmed. Tap for details.`,
      url: "/hazard-map",
      tag: `ai-${data._dedupeKey}`,
      urgent: false,
    }).catch((err) => console.error("[Push] AI alert push failed:", err.message));
  }

  return isNew;
}
