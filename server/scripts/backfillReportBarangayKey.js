/**
 * scripts/backfillReportBarangayKey.js
 *
 * One-off backfill: derives barangayKey for every existing emergency_reports
 * document that doesn't already have one, using the same resolution order
 * new reports use (routes/reports.js) — free-text barangay first, falling
 * back to nearest-centroid from coordinates. Needed because barangay_official
 * accounts are now scoped to reports matching their assignedBarangay via
 * barangayKey, and pre-existing reports predate that field.
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

await mongoose.connect(process.env.MONGO_URI);
console.log("Connected to MongoDB...");

const reports = await mongoose.connection.db
  .collection("emergency_reports")
  .find({ barangayKey: { $in: [null, undefined] } })
  .toArray();

console.log(`Found ${reports.length} report(s) missing barangayKey.`);

let updated = 0;
let unresolved = 0;

for (const report of reports) {
  const freeTextBarangay = report.barangay || report.location?.barangay || "";
  const lat = typeof report.latitude === "number" ? report.latitude : report.location?.coordinates?.latitude;
  const lng = typeof report.longitude === "number" ? report.longitude : report.location?.coordinates?.longitude;
  const barangayKey = resolveBarangayKey(freeTextBarangay) ?? nearestBarangayKey(lat, lng);

  if (!barangayKey) {
    unresolved++;
    continue;
  }

  await mongoose.connection.db
    .collection("emergency_reports")
    .updateOne({ _id: report._id }, { $set: { barangayKey } });
  updated++;
}

console.log(`✅ Updated ${updated} report(s). ${unresolved} could not be resolved (no usable location).`);
await mongoose.disconnect();
process.exit(0);
