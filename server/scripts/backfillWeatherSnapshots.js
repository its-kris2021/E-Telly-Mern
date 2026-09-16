/**
 * scripts/backfillWeatherSnapshots.js
 *
 * One-off backfill: attaches a weatherSnapshot to every existing approved
 * report that doesn't already have one, using Open-Meteo's Historical
 * Weather (archive) API instead of the live forecast API — this produces
 * labeled training examples immediately from whatever reports already exist
 * in the database, instead of waiting weeks for the live 30-min capture
 * (services/weatherSnapshotService.js) to accumulate enough data.
 *
 * Run manually: node scripts/backfillWeatherSnapshots.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { BARANGAY_COORDS, resolveBarangayKey, nearestBarangayKey } from "../config/barangays.js";
import { extractSnapshotFeatures, extractRiverDischargeFeature } from "../services/weatherSnapshotService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

// Separate from openMeteoCache.js on purpose — archive-api.open-meteo.com is a
// different host with different date-range semantics than the forecast API,
// and this is a one-off script, not a cached/rate-limited live code path.
async function fetchHistorical(lat, lon, centerDate) {
  const start = new Date(centerDate);
  start.setDate(start.getDate() - 4); // 3 days of lookback + 1 day margin
  const end = new Date(centerDate);
  end.setDate(end.getDate() + 1);
  const fmt = (d) => d.toISOString().slice(0, 10);

  const url =
    `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${lat}&longitude=${lon}` +
    `&start_date=${fmt(start)}&end_date=${fmt(end)}` +
    `&hourly=precipitation,soil_moisture_0_to_7cm,soil_moisture_7_to_28cm,` +
    `windspeed_10m,surface_pressure,et0_fao_evapotranspiration` +
    `&timezone=Asia%2FManila`;

  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Open-Meteo archive API returned ${r.status}`);
  return r.json();
}

// Flood API — separate host/API, daily-resolution GloFAS river discharge.
async function fetchRiverDischargeHistorical(lat, lon, centerDate) {
  const start = new Date(centerDate);
  start.setDate(start.getDate() - 1);
  const end = new Date(centerDate);
  end.setDate(end.getDate() + 1);
  const fmt = (d) => d.toISOString().slice(0, 10);

  const url =
    `https://flood-api.open-meteo.com/v1/flood` +
    `?latitude=${lat}&longitude=${lon}` +
    `&start_date=${fmt(start)}&end_date=${fmt(end)}` +
    `&daily=river_discharge&timezone=Asia%2FManila`;

  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Open-Meteo flood API returned ${r.status}`);
  return r.json();
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB...");

  const col = mongoose.connection.db.collection("emergency_reports");
  const reports = await col
    .find({ status: { $in: ["approved", "resolved"] }, weatherSnapshot: { $exists: false } })
    .toArray();

  console.log(`Found ${reports.length} approved/resolved report(s) without a weatherSnapshot.`);

  let ok = 0, skipped = 0, failed = 0;

  for (const report of reports) {
    try {
      const freeTextBarangay = report.barangay || report.location?.barangay || "";
      const lat = typeof report.latitude === "number" ? report.latitude : report.location?.coordinates?.latitude;
      const lng = typeof report.longitude === "number" ? report.longitude : report.location?.coordinates?.longitude;
      const barangayKey = resolveBarangayKey(freeTextBarangay) ?? nearestBarangayKey(lat, lng);
      const reportTime = report.timestamp ? new Date(report.timestamp) : null;

      if (!barangayKey || !reportTime || Number.isNaN(reportTime.getTime())) {
        skipped++;
        continue;
      }

      const coord = BARANGAY_COORDS[barangayKey];
      const weatherRaw = await fetchHistorical(coord.lat, coord.lng, reportTime);
      let riverDischarge = 0;
      try {
        const dischargeRaw = await fetchRiverDischargeHistorical(coord.lat, coord.lng, reportTime);
        riverDischarge = extractRiverDischargeFeature(dischargeRaw, reportTime);
      } catch (err) {
        console.error(`  River discharge fetch failed for report ${report._id} (proceeding with 0):`, err.message);
      }
      const weatherSnapshot = {
        barangay: barangayKey,
        ...extractSnapshotFeatures(weatherRaw, reportTime),
        riverDischarge,
        capturedAt: reportTime,
      };

      await col.updateOne({ _id: report._id }, { $set: { weatherSnapshot } });
      ok++;

      // Be polite to the free-tier archive API.
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (err) {
      failed++;
      console.error(`  Failed for report ${report._id}:`, err.message);
    }
  }

  console.log(`Done. Backfilled: ${ok}, skipped (no location/timestamp): ${skipped}, failed: ${failed}.`);

  await mongoose.disconnect();
  process.exit(0);
}

run();
