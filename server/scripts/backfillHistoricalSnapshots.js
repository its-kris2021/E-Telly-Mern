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
 * for the live forecast API) instead of one call per barangay-day.
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
import { extractSnapshotFeatures } from "../services/weatherSnapshotService.js";

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
    `&hourly=precipitation,soil_moisture_0_to_7cm,soil_moisture_7_to_28cm` +
    `&timezone=Asia%2FManila`;

  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`Open-Meteo archive API returned ${r.status}`);
  const data = await r.json();
  return Array.isArray(data) ? data : [data]; // single-location requests aren't wrapped in an array
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

  let totalInserted = 0, totalSkippedExisting = 0, totalFailedYears = 0;

  for (let year = startYear; year <= endYear; year++) {
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const rangeStart = yearStart < range.start ? range.start : yearStart;
    const rangeEnd = yearEnd > range.end ? range.end : yearEnd;
    const fetchStart = addDays(rangeStart, -LOOKBACK_BUFFER_DAYS);

    console.log(`\n── ${year}: fetching ${fetchStart} .. ${rangeEnd} for all barangays ──`);
    let batch;
    try {
      batch = await fetchArchiveBatch(coordsList, fetchStart, rangeEnd);
    } catch (err) {
      console.error(`  Fetch failed for ${year}:`, err.message);
      totalFailedYears++;
      continue;
    }

    const docs = [];
    for (const day of eachDay(rangeStart, rangeEnd)) {
      const refDate = new Date(`${day}T23:00:00+08:00`);
      const dayStart = new Date(`${day}T00:00:00+08:00`);
      const dayEnd = addDaysDate(dayStart, 1);

      for (let i = 0; i < coordsList.length; i++) {
        const { key, lat, lon } = coordsList[i];
        const exists = await HazardSnapshot.exists({ barangay: key, capturedAt: { $gte: dayStart, $lt: dayEnd } });
        if (exists) { totalSkippedExisting++; continue; }

        const features = extractSnapshotFeatures(batch[i], refDate);
        docs.push({ barangay: key, lat, lng: lon, capturedAt: refDate, ...features });
      }
    }

    if (docs.length > 0) {
      await HazardSnapshot.insertMany(docs, { ordered: false });
      totalInserted += docs.length;
      console.log(`  Inserted ${docs.length} barangay-day snapshot(s) for ${year}.`);
    } else {
      console.log(`  Nothing new for ${year} (already backfilled).`);
    }

    await new Promise((resolve) => setTimeout(resolve, 500)); // polite to the free-tier archive API
  }

  console.log(
    `\nDone. Inserted ${totalInserted}, already existed (skipped) ${totalSkippedExisting}, ` +
    `years that failed to fetch: ${totalFailedYears}.`,
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
