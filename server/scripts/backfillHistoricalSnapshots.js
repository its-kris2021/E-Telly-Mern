/**
 * scripts/backfillHistoricalSnapshots.js
 *
 * Fills in server/models/HazardSnapshot.js for past dates so
 * scripts/buildTrainingSet.js has feature rows to join the historical
 * import (scripts/importHistoricalReports.js) against.
 *
 * This is a distinct gap from scripts/backfillWeatherSnapshots.js, which
 * only patches a `weatherSnapshot` field onto individual report docs —
 * buildTrainingSet.js never reads that field, it reads HazardSnapshot.
 * Without this script, historical reports produce zero training rows no
 * matter how far back they go.
 *
 * Deliberately captures one snapshot per barangay per CALENDAR DAY across
 * the *entire* date range, not just days a report exists for — per
 * HazardSnapshot.js's own comment, snapshots with no matching report are
 * what let the model learn what "safe" conditions look like. Skipping
 * those would leave the training set with only positive examples.
 *
 * Batches all 17 barangays into one Open-Meteo archive-api call per year
 * (comma-separated lat/lon, same pattern services/openMeteoCache.js uses
 * for the live forecast API) instead of one call per barangay-day. Also
 * fetches river discharge (Open-Meteo's separate Flood API) per year, same
 * batching approach.
 *
 * Idempotent per barangay-day, not per-run: a day that already has a
 * snapshot but predates the wind/pressure/et0/river-discharge fields gets
 * those fields filled in via update rather than skipped; a day whose
 * snapshot already has them is skipped as before.
 *
 * Run manually:
 *   node scripts/backfillHistoricalSnapshots.js [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]
 *
 * With no --start/--end, the range is auto-detected from the earliest/latest
 * timestamp among reports imported by importHistoricalReports.js.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import HazardSnapshot from "../models/HazardSnapshot.js";
import { BARANGAY_COORDS, BARANGAY_KEYS } from "../config/barangays.js";
import { extractSnapshotFeatures, extractRiverDischargeFeature } from "../services/weatherSnapshotService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const IMPORT_SOURCE = "historical_excel_import";
const LOOKBACK_BUFFER_DAYS = 3; // so rain_72h has full history even on a year's first day

function dayKeyManila(date) {
  return new Date(date).toLocaleString("en-CA", { timeZone: "Asia/Manila" }).slice(0, 10); // YYYY-MM-DD
}

function addDays(dayKey, n) {
  const d = new Date(`${dayKey}T00:00:00+08:00`);
  d.setDate(d.getDate() + n);
  return dayKeyManila(d);
}

function* eachDay(startDayKey, endDayKey) {
  let cur = startDayKey;
  while (cur <= endDayKey) {
    yield cur;
    cur = addDays(cur, 1);
  }
}

async function fetchArchiveBatch(coordsList, startDate, endDate) {
  const lats = coordsList.map((c) => c.lat).join(",");
  const lons = coordsList.map((c) => c.lon).join(",");
  const url =
    `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${lats}&longitude=${lons}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&hourly=precipitation,soil_moisture_0_to_7cm,soil_moisture_7_to_28cm,` +
    `windspeed_10m,surface_pressure,et0_fao_evapotranspiration` +
    `&timezone=Asia%2FManila`;

  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`Open-Meteo archive API returned ${r.status}`);
  const data = await r.json();
  return Array.isArray(data) ? data : [data]; // single-location requests aren't wrapped in an array
}

// Flood API (flood-api.open-meteo.com) is a separate host/API at daily
// resolution — GloFAS river discharge, a direct hydrological flood signal
// distinct from the rainfall/soil-moisture archive call above. Its own
// start_date/end_date range works the same way for historical queries.
async function fetchRiverDischargeArchiveBatch(coordsList, startDate, endDate) {
  const lats = coordsList.map((c) => c.lat).join(",");
  const lons = coordsList.map((c) => c.lon).join(",");
  const url =
    `https://flood-api.open-meteo.com/v1/flood` +
    `?latitude=${lats}&longitude=${lons}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&daily=river_discharge&timezone=Asia%2FManila`;

  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`Open-Meteo flood API returned ${r.status}`);
  const data = await r.json();
  return Array.isArray(data) ? data : [data];
}

async function detectDateRange() {
  const col = mongoose.connection.db.collection("emergency_reports");
  const [{ min, max } = {}] = await col
    .aggregate([
      { $match: { importSource: IMPORT_SOURCE } },
      { $group: { _id: null, min: { $min: "$timestamp" }, max: { $max: "$timestamp" } } },
    ])
    .toArray();
  return min && max ? { start: dayKeyManila(min), end: dayKeyManila(max) } : null;
}

async function run() {
  const args = process.argv.slice(2);
  const startArg = args.find((a) => a.startsWith("--start="))?.split("=")[1];
  const endArg = args.find((a) => a.startsWith("--end="))?.split("=")[1];

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB...");

  let range = startArg && endArg ? { start: startArg, end: endArg } : await detectDateRange();
  if (!range) {
    console.log(
      "No historical reports found (run scripts/importHistoricalReports.js first), " +
      "and no --start/--end given. Nothing to do.",
    );
    await mongoose.disconnect();
    return;
  }
  console.log(`Backfilling HazardSnapshot for ${range.start} .. ${range.end} across ${BARANGAY_KEYS.length} barangays.`);

  const coordsList = BARANGAY_KEYS.map((key) => ({ key, lat: BARANGAY_COORDS[key].lat, lon: BARANGAY_COORDS[key].lng }));

  const startYear = parseInt(range.start.slice(0, 4), 10);
  const endYear = parseInt(range.end.slice(0, 4), 10);

  let totalInserted = 0, totalUpdated = 0, totalSkippedExisting = 0, totalFailedYears = 0;

  for (let year = startYear; year <= endYear; year++) {
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const rangeStart = yearStart < range.start ? range.start : yearStart;
    const rangeEnd = yearEnd > range.end ? range.end : yearEnd;
    const fetchStart = addDays(rangeStart, -LOOKBACK_BUFFER_DAYS);

    console.log(`\n── ${year}: fetching ${fetchStart} .. ${rangeEnd} for all barangays ──`);
    let batch, dischargeBatch;
    try {
      batch = await fetchArchiveBatch(coordsList, fetchStart, rangeEnd);
    } catch (err) {
      console.error(`  Fetch failed for ${year}:`, err.message);
      totalFailedYears++;
      continue;
    }
    try {
      dischargeBatch = await fetchRiverDischargeArchiveBatch(coordsList, rangeStart, rangeEnd);
    } catch (err) {
      console.error(`  River discharge fetch failed for ${year} (proceeding with riverDischarge=0):`, err.message);
      dischargeBatch = null;
    }

    const docs = [];
    let yearUpdated = 0;
    for (const day of eachDay(rangeStart, rangeEnd)) {
      const refDate = new Date(`${day}T23:00:00+08:00`);
      const dayStart = new Date(`${day}T00:00:00+08:00`);
      const dayEnd = addDaysDate(dayStart, 1);

      for (let i = 0; i < coordsList.length; i++) {
        const { key, lat, lon } = coordsList[i];
        // findOne (not exists), with .lean() so a doc that never actually
        // stored riverDischarge comes back as genuinely undefined instead of
        // Mongoose silently applying the schema's `default: 0` on hydration
        // (which would make every pre-existing doc look "already up to
        // date" and defeat this entire fill-in path).
        const existing = await HazardSnapshot.findOne(
          { barangay: key, capturedAt: { $gte: dayStart, $lt: dayEnd } },
          { riverDischarge: 1 },
        ).lean();

        const riverDischarge = dischargeBatch ? extractRiverDischargeFeature(dischargeBatch[i], refDate) : 0;

        if (existing) {
          if (existing.riverDischarge !== undefined) { totalSkippedExisting++; continue; }
          const features = extractSnapshotFeatures(batch[i], refDate);
          await HazardSnapshot.updateOne({ _id: existing._id }, { $set: { ...features, riverDischarge } });
          yearUpdated++;
          continue;
        }

        const features = extractSnapshotFeatures(batch[i], refDate);
        docs.push({ barangay: key, lat, lng: lon, capturedAt: refDate, ...features, riverDischarge });
      }
    }
    if (yearUpdated > 0) {
      totalUpdated += yearUpdated;
      console.log(`  Filled in new fields on ${yearUpdated} pre-existing snapshot(s) for ${year}.`);
    }

    if (docs.length > 0) {
      await HazardSnapshot.insertMany(docs, { ordered: false });
      totalInserted += docs.length;
      console.log(`  Inserted ${docs.length} barangay-day snapshot(s) for ${year}.`);
    } else if (yearUpdated === 0) {
      console.log(`  Nothing new for ${year} (already backfilled).`);
    }

    await new Promise((resolve) => setTimeout(resolve, 500)); // polite to the free-tier archive API
  }

  console.log(
    `\nDone. Inserted ${totalInserted}, updated with new fields ${totalUpdated}, ` +
    `already up to date (skipped) ${totalSkippedExisting}, years that failed to fetch: ${totalFailedYears}.`,
  );

  await mongoose.disconnect();
  process.exit(0);
}

function addDaysDate(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

run().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
