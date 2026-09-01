/**
 * scripts/buildTrainingSet.js
 *
 * Joins server/models/HazardSnapshot.js (periodic per-barangay weather
 * captures) with the `emergency_reports` collection into labeled
 * feature/label rows scripts/trainRiskModel.js can train on.
 *
 * Labeling granularity is day + barangay, not minute-level timestamps.
 * Citizen reports can arrive hours late via offline WiFi/mesh relay (see
 * OFFLINE_IMPLEMENTATION.md in etelly-mobile) — a tight time window would
 * wrongly label a real event as "nothing happened" just because the report
 * hadn't synced in yet. So:
 *   label = 1  if an approved report of `hazardType` was filed in this
 *              barangay on this calendar day OR the next day (Asia/Manila)
 *   label = 0  otherwise, for every barangay-day we actually have weather
 *              data for (from HazardSnapshot)
 *
 * Exported for scripts/trainRiskModel.js to import directly; also runnable
 * standalone (`node scripts/buildTrainingSet.js flood`) to inspect the
 * resulting dataset size before committing to a training run.
 */

import mongoose from "mongoose";
import HazardSnapshot from "../models/HazardSnapshot.js";
import { BARANGAY_KEYS, resolveBarangayKey, nearestBarangayKey } from "../config/barangays.js";
import {
  FEATURE_NAMES,
  buildBarangayReportIndex,
  computeBarangayReportRateFromIndex,
  susceptibilityFeature,
  toFeatureVector,
} from "../services/riskFeatures.js";

function dayKeyManila(date) {
  return new Date(date).toLocaleString("en-CA", { timeZone: "Asia/Manila" }).slice(0, 10); // YYYY-MM-DD
}

function addDays(dayKey, n) {
  const d = new Date(`${dayKey}T00:00:00+08:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleString("en-CA", { timeZone: "Asia/Manila" }).slice(0, 10);
}

// Groups HazardSnapshot docs by barangay-day, keeping the snapshot with the
// highest rain_24h that day (i.e. the day's peak-conditions reading) as the
// representative feature source for that barangay-day.
async function loadBarangayDaySnapshots() {
  const snapshots = await HazardSnapshot.find({}).lean();
  const byKey = new Map(); // "barangay|day" -> snapshot

  for (const snap of snapshots) {
    const day = dayKeyManila(snap.capturedAt);
    const key = `${snap.barangay}|${day}`;
    const existing = byKey.get(key);
    if (!existing || snap.rain_24h > existing.rain_24h) {
      byKey.set(key, { ...snap, day });
    }
  }
  return [...byKey.values()];
}

async function loadApprovedReportsByBarangayDay(reportsCol) {
  const reports = await reportsCol
    .find({ status: "approved" })
    .project({ barangay: 1, location: 1, latitude: 1, longitude: 1, timestamp: 1, emergencyType: 1 })
    .toArray();

  // Map "barangay|day" -> Set of emergencyTypes reported that day.
  const byKey = new Map();
  for (const r of reports) {
    if (!r.timestamp) continue;
    const freeText = r.barangay || r.location?.barangay || "";
    const lat = typeof r.latitude === "number" ? r.latitude : r.location?.coordinates?.latitude;
    const lng = typeof r.longitude === "number" ? r.longitude : r.location?.coordinates?.longitude;
    const barangayKey = resolveBarangayKey(freeText) ?? nearestBarangayKey(lat, lng);
    if (!barangayKey) continue;

    const day = dayKeyManila(r.timestamp);
    const key = `${barangayKey}|${day}`;
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key).add(r.emergencyType);
  }
  return byKey;
}

export async function buildTrainingSet(hazardType) {
  const reportsCol = mongoose.connection.db.collection("emergency_reports");

  const [snapshots, reportsByKey, reportRateIndex] = await Promise.all([
    loadBarangayDaySnapshots(),
    loadApprovedReportsByBarangayDay(reportsCol),
    buildBarangayReportIndex(reportsCol),
  ]);

  const rows = [];
  for (const snap of snapshots) {
    if (!BARANGAY_KEYS.includes(snap.barangay)) continue;

    const nextDay = addDays(snap.day, 1);
    const todaySet = reportsByKey.get(`${snap.barangay}|${snap.day}`);
    const nextDaySet = reportsByKey.get(`${snap.barangay}|${nextDay}`);
    const label =
      (todaySet && todaySet.has(hazardType)) || (nextDaySet && nextDaySet.has(hazardType)) ? 1 : 0;

    const barangayReportRate30d = computeBarangayReportRateFromIndex(
      reportRateIndex, snap.barangay, new Date(`${snap.day}T00:00:00+08:00`), 30,
    );

    const named = {
      rain_6h: snap.rain_6h,
      rain_24h: snap.rain_24h,
      soilTop: snap.soilTop,
      soilDeep: snap.soilDeep,
      barangayReportRate30d,
      susceptibility: susceptibilityFeature(snap.barangay),
      windSpeed10m: snap.windSpeed10m,
      surfacePressure: snap.surfacePressure,
      et0_24h: snap.et0_24h,
      riverDischarge: snap.riverDischarge,
    };

    rows.push({
      barangay: snap.barangay,
      day: snap.day,
      features: toFeatureVector(named),
      label,
    });
  }

  return { rows, featureNames: FEATURE_NAMES };
}

// Standalone inspection: `node scripts/buildTrainingSet.js flood`
// (pathToFileURL, not manual `file://` string-building — the latter never
// matches on Windows, where process.argv[1] uses backslashes.)
const { pathToFileURL } = await import("url");
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dotenv = await import("dotenv");
  const { fileURLToPath } = await import("url");
  const { dirname, join } = await import("path");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: join(__dirname, "../.env") });

  const hazardType = process.argv[2] || "flood";
  await mongoose.connect(process.env.MONGO_URI);
  const { rows } = await buildTrainingSet(hazardType);
  const positives = rows.filter((r) => r.label === 1).length;
  console.log(`hazardType=${hazardType} rows=${rows.length} positives=${positives} negatives=${rows.length - positives}`);
  await mongoose.disconnect();
  process.exit(0);
}
