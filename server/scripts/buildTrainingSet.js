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
// representative feature source for that barangay-day. Done as a MongoDB
// aggregation, not a `.find({}).lean()` + in-JS reduction, because the
// underlying collection is raw per-capture ticks (every 30 min, ~816/day)
// going back to a 2020 historical backfill — 71k+ docs and growing forever.
// Loading all of that into Node on every retrain is exactly what OOM-killed
// the web dyno nightly (R14/R15, see trainRiskModel.js header). Reducing
// server-side bounds the result to one doc per barangay-per-day — growth is
// now ~17 rows/day (barangay count), not ~816/day (capture frequency) — with
// no cutoff on history, so the multi-year seasonal backfill stays available
// to the model.
async function loadBarangayDaySnapshots() {
  // $top picks the whole doc with the highest rain_24h per group without a
  // blocking collection-wide $sort stage first — a plain $sort here (which
  // is what this used to do) exceeds Atlas's 32MB in-memory sort limit at
  // 71k+ docs and errors out (QueryExceededMemoryLimitNoDiskUseAllowed)
  // rather than silently falling back to slow disk sorting.
  const docs = await HazardSnapshot.aggregate([
    {
      $addFields: {
        day: {
          $dateToString: { format: "%Y-%m-%d", date: "$capturedAt", timezone: "Asia/Manila" },
        },
      },
    },
    {
      $group: {
        _id: { barangay: "$barangay", day: "$day" },
        doc: { $top: { sortBy: { rain_24h: -1 }, output: "$$ROOT" } },
      },
    },
    { $replaceRoot: { newRoot: { $mergeObjects: ["$doc", { day: "$_id.day" }] } } },
  ]);
  return docs;
}

async function loadApprovedReportsByBarangayDay(reportsCol) {
  // "resolved" is included alongside "approved" — it's the same verified
  // report, just later in its lifecycle (CDRRMO/barangay official addressed
  // it), not a different or less-trustworthy kind of report. Excluding it
  // would silently drop most real reports from training once they're closed
  // out, leaving only the historical import as a labeled data source.
  const reports = await reportsCol
    .find({ status: { $in: ["approved", "resolved"] } })
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

// Loads everything buildTrainingSet() needs from Mongo, once. flood and
// landslide training runs both need the exact same snapshots/reports — only
// the label computation differs per hazardType — so trainRiskModel.js loads
// this a single time and reuses it for both, instead of hitting the DB (and
// holding two full copies in memory at once) for every hazard type.
export async function loadSharedTrainingData() {
  const reportsCol = mongoose.connection.db.collection("emergency_reports");

  const [snapshots, reportsByKey, reportRateIndex] = await Promise.all([
    loadBarangayDaySnapshots(),
    loadApprovedReportsByBarangayDay(reportsCol),
    buildBarangayReportIndex(reportsCol),
  ]);

  return { snapshots, reportsByKey, reportRateIndex };
}

export async function buildTrainingSet(hazardType, sharedData) {
  const { snapshots, reportsByKey, reportRateIndex } = sharedData ?? (await loadSharedTrainingData());

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
