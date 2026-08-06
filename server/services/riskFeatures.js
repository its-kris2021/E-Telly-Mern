/**
 * services/riskFeatures.js
 *
 * The single place the feature vector for the risk model is defined — used
 * by scripts/buildTrainingSet.js (historical, for training) and
 * services/predictionEngine.js (live, for inference) so both are guaranteed
 * to build features the exact same way and in the exact same order.
 *
 * Kept small and explainable on purpose (6 features): with a capstone-scale
 * dataset (tens to low hundreds of labeled barangay-days), a handful of
 * physically-grounded features beats a large feature set that would just
 * overfit.
 */

import { HIGH_SUSCEPTIBILITY_BARANGAYS, resolveBarangayKey, nearestBarangayKey } from "../config/barangays.js";

export const FEATURE_NAMES = [
  "rain_6h",
  "rain_24h",
  "soilTop",
  "soilDeep",
  "barangayReportRate30d",
  "susceptibility",
];

// Static, zero-data-required signal: is this a documented high-susceptibility
// slope area? (MGB geohazard mapping — see config/barangays.js.) Applied to
// both the flood and landslide models since steep-terrain barangays also see
// faster runoff-driven flash flooding, not just slope failure.
export function susceptibilityFeature(barangayKey) {
  return HIGH_SUSCEPTIBILITY_BARANGAYS.includes(barangayKey) ? 1 : 0;
}

// Rolling count of approved reports (any hazard type) filed in this barangay
// in the `windowDays` before `asOfDate` (exclusive of asOfDate itself, so a
// day's own reports never leak into its own vulnerability feature). This is
// deliberately a multi-week window, not a "reports in the last hour" feature
// — a rolling 30-day rate is insensitive to a report arriving a few hours
// late via offline mesh relay (see OFFLINE_IMPLEMENTATION.md in etelly-mobile),
// which a short window would not be.
export async function computeBarangayReportRate(reportsCol, barangayKey, asOfDate, windowDays = 30) {
  const windowEnd   = new Date(asOfDate);
  windowEnd.setHours(0, 0, 0, 0);
  const windowStart = new Date(windowEnd);
  windowStart.setDate(windowStart.getDate() - windowDays);

  // emergency_reports carries a free-text barangay string, not the canonical
  // key — resolve the same way routes/reports.js does when attaching
  // weatherSnapshot, so training features and live features stay consistent.
  const candidates = await reportsCol
    .find({
      status: "approved",
      timestamp: { $gte: windowStart, $lt: windowEnd },
    })
    .project({ barangay: 1, location: 1, latitude: 1, longitude: 1 })
    .toArray();

  let count = 0;
  for (const r of candidates) {
    const freeText = r.barangay || r.location?.barangay || "";
    const lat = typeof r.latitude === "number" ? r.latitude : r.location?.coordinates?.latitude;
    const lng = typeof r.longitude === "number" ? r.longitude : r.location?.coordinates?.longitude;
    const key = resolveBarangayKey(freeText) ?? nearestBarangayKey(lat, lng);
    if (key === barangayKey) count++;
  }
  return count;
}

// Converts a named feature object into the ordered vector logisticRegression.js
// expects — the single point where FEATURE_NAMES order is enforced.
export function toFeatureVector(named) {
  return FEATURE_NAMES.map((name) => named[name] ?? 0);
}

// Loads every approved report once and buckets its timestamp by resolved
// barangay, sorted ascending — lets buildTrainingSet.js compute a rolling
// 30-day report-rate per barangay-day entirely in memory instead of one
// computeBarangayReportRate() network round-trip per row. That per-row query
// was the dominant cost of a full retrain (~47ms x tens of thousands of
// barangay-day rows, ~25 min per hazard type against the real dataset).
// predictionEngine.js's live path still uses computeBarangayReportRate()
// directly below — it only needs 17 lookups per cycle, not worth indexing for.
export async function buildBarangayReportIndex(reportsCol) {
  const reports = await reportsCol
    .find({ status: "approved" })
    .project({ barangay: 1, location: 1, latitude: 1, longitude: 1, timestamp: 1 })
    .toArray();

  const index = new Map(); // barangayKey -> sorted array of timestamps (ms)
  for (const r of reports) {
    if (!r.timestamp) continue;
    const freeText = r.barangay || r.location?.barangay || "";
    const lat = typeof r.latitude === "number" ? r.latitude : r.location?.coordinates?.latitude;
    const lng = typeof r.longitude === "number" ? r.longitude : r.location?.coordinates?.longitude;
    const key = resolveBarangayKey(freeText) ?? nearestBarangayKey(lat, lng);
    if (!key) continue;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(new Date(r.timestamp).getTime());
  }
  for (const timestamps of index.values()) timestamps.sort((a, b) => a - b);
  return index;
}

function lowerBound(sortedArr, target) {
  let lo = 0, hi = sortedArr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedArr[mid] < target) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// In-memory equivalent of computeBarangayReportRate, reading from an index
// built by buildBarangayReportIndex() — same [windowStart, windowEnd)
// semantics (asOfDate's own reports excluded), just no network round-trip.
export function computeBarangayReportRateFromIndex(index, barangayKey, asOfDate, windowDays = 30) {
  const windowEnd = new Date(asOfDate);
  windowEnd.setHours(0, 0, 0, 0);
  const windowStart = new Date(windowEnd);
  windowStart.setDate(windowStart.getDate() - windowDays);

  const timestamps = index.get(barangayKey);
  if (!timestamps) return 0;

  return lowerBound(timestamps, windowEnd.getTime()) - lowerBound(timestamps, windowStart.getTime());
}
