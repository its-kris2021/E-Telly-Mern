/**
 * scripts/repairSnapshotFeatureGap.js
 *
 * One-off repair: 25,602 HazardSnapshot docs captured 2026-08-02..2026-09-01
 * are missing windSpeed10m/surfacePressure/et0_24h/riverDischarge entirely
 * (not zeroed — genuinely absent from the stored doc). These fields were
 * added to the live capture path (services/weatherSnapshotService.js) partway
 * through that window, so these docs simply predate the fields rather than
 * reflecting a live Open-Meteo failure — confirmed the same variable names
 * (windspeed_10m, surface_pressure, et0_fao_evapotranspiration) return real
 * data from the live API today. rain_1h..rain_72h/soilTop/soilDeep on these
 * docs are correct and are left untouched; only the 4 missing fields are set.
 *
 * Backs up every affected doc's pre-repair state to a local JSON file BEFORE
 * writing anything, then re-derives the 4 missing fields from Open-Meteo's
 * historical archive API (same hourly variables, same extraction functions
 * services/weatherSnapshotService.js already uses for live capture) and
 * $set's only those fields, by _id.
 *
 * Dry run by default — prints what WOULD change, writes nothing.
 *   node scripts/repairSnapshotFeatureGap.js             (dry run)
 *   node scripts/repairSnapshotFeatureGap.js --apply      (writes, after backup)
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import HazardSnapshot from "../models/HazardSnapshot.js";
import { BARANGAY_COORDS, BARANGAY_KEYS } from "../config/barangays.js";
import { extractSnapshotFeatures, extractRiverDischargeFeature } from "../services/weatherSnapshotService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const APPLY = process.argv.includes("--apply");
const BACKUP_DIR = process.env.REPAIR_BACKUP_DIR || join(__dirname, "../../_backups");

// Matches on true field absence (Mongo's null-equality also matches missing
// fields) — NOT value-0, since 0 is a legitimate reading for some of these.
const MISSING_FILTER = {
  $or: [
    { windSpeed10m: null },
    { surfacePressure: null },
    { et0_24h: null },
    { riverDischarge: null },
  ],
};

async function fetchArchiveWeatherBatch(coordsList, startDate, endDate) {
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
  if (!r.ok) throw new Error(`archive API returned ${r.status}`);
  const data = await r.json();
  return Array.isArray(data) ? data : [data]; // single-location requests aren't wrapped in an array
}

async function fetchArchiveRiverDischargeBatch(coordsList, startDate, endDate) {
  const lats = coordsList.map((c) => c.lat).join(",");
  const lons = coordsList.map((c) => c.lon).join(",");
  const url =
    `https://flood-api.open-meteo.com/v1/flood` +
    `?latitude=${lats}&longitude=${lons}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&daily=river_discharge&timezone=Asia%2FManila`;
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`flood API returned ${r.status}`);
  const data = await r.json();
  return Array.isArray(data) ? data : [data];
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected. Mode: ${APPLY ? "APPLY (will write)" : "DRY RUN (no writes)"}`);

  const affected = await HazardSnapshot.find(MISSING_FILTER).lean();
  console.log(`Found ${affected.length} docs missing >=1 of windSpeed10m/surfacePressure/et0_24h/riverDischarge.`);
  if (affected.length === 0) {
    console.log("Nothing to repair.");
    await mongoose.disconnect();
    return;
  }

  const dates = affected.map((d) => new Date(d.capturedAt).toISOString().slice(0, 10)).sort();
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];
  console.log(`Affected date range: ${startDate} .. ${endDate}`);

  // Backup BEFORE any write — full pre-repair doc state, every field.
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(BACKUP_DIR, `hazardsnapshot-repair-backup-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(affected, null, 2));
  console.log(`Backed up ${affected.length} pre-repair docs to ${backupPath}`);

  const coordsList = BARANGAY_KEYS.map((key) => ({ key, lat: BARANGAY_COORDS[key].lat, lon: BARANGAY_COORDS[key].lng }));
  console.log(`Fetching archive weather + river discharge for ${coordsList.length} barangays, ${startDate}..${endDate}...`);
  const [weatherBatch, dischargeBatch] = await Promise.all([
    fetchArchiveWeatherBatch(coordsList, startDate, endDate),
    fetchArchiveRiverDischargeBatch(coordsList, startDate, endDate),
  ]);

  const keyToIdx = new Map(coordsList.map((c, i) => [c.key, i]));
  const ops = [];
  let skippedNoBarangay = 0;

  for (const doc of affected) {
    const idx = keyToIdx.get(doc.barangay);
    if (idx == null) { skippedNoBarangay++; continue; }

    const refDate = new Date(doc.capturedAt);
    const features = extractSnapshotFeatures(weatherBatch[idx], refDate);
    const riverDischarge = extractRiverDischargeFeature(dischargeBatch[idx], refDate);

    // Only ever set fields that were actually missing on this doc — never
    // touch rain_*/soilTop/soilDeep, which are already correct.
    const set = {};
    if (doc.windSpeed10m == null) set.windSpeed10m = features.windSpeed10m;
    if (doc.surfacePressure == null) set.surfacePressure = features.surfacePressure;
    if (doc.et0_24h == null) set.et0_24h = features.et0_24h;
    if (doc.riverDischarge == null) set.riverDischarge = riverDischarge;

    ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: set } } });
  }

  console.log(`Prepared ${ops.length} updates (${skippedNoBarangay} skipped — barangay key not in current config).`);
  if (ops.length > 0) console.log("Sample update:", JSON.stringify(ops[0], null, 2));

  if (!APPLY) {
    console.log("\nDRY RUN — no writes performed. Re-run with --apply to write (backup above is still useful as a pre-check).");
    await mongoose.disconnect();
    return;
  }

  let modified = 0;
  for (let i = 0; i < ops.length; i += 1000) {
    const batch = ops.slice(i, i + 1000);
    const res = await HazardSnapshot.bulkWrite(batch, { ordered: false });
    modified += res.modifiedCount ?? 0;
    console.log(`  ...${Math.min(i + 1000, ops.length)}/${ops.length}`);
  }
  console.log(`\nDone. Modified ${modified} docs. Backup at ${backupPath}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Repair failed:", err);
  process.exit(1);
});
