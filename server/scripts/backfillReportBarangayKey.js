/**
 * scripts/backfillReportBarangayKey.js
 *
 * One-off backfill: resolves and stores the canonical `barangayKey` on every
 * existing report that doesn't already have one. New reports get this set at
 * write time (see routes/reports.js), but barangay_official report scoping
 * (middleware/auth.js reportBarangayFilter) needs it on historical reports
 * too, or officials won't see anything submitted before this feature shipped.
 *
 * Run manually: node scripts/backfillReportBarangayKey.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { resolveBarangayKey, nearestBarangayKey } from "../config/barangays.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB...");

  const col = mongoose.connection.db.collection("emergency_reports");
  const reports = await col
    .find({ barangayKey: { $exists: false } })
    .toArray();

  console.log(`Found ${reports.length} report(s) without a barangayKey.`);

  let ok = 0, unresolved = 0;

  for (const report of reports) {
    const freeTextBarangay = report.barangay || report.location?.barangay || "";
    const lat = typeof report.latitude === "number" ? report.latitude : report.location?.coordinates?.latitude;
    const lng = typeof report.longitude === "number" ? report.longitude : report.location?.coordinates?.longitude;
    const barangayKey = resolveBarangayKey(freeTextBarangay) ?? nearestBarangayKey(lat, lng);

    await col.updateOne({ _id: report._id }, { $set: { barangayKey: barangayKey ?? null } });
    if (barangayKey) ok++; else unresolved++;
  }

  console.log(`Done. Resolved: ${ok}, unresolved (no usable location — left null, only admins will see these): ${unresolved}.`);

  await mongoose.disconnect();
  process.exit(0);
}

run();
