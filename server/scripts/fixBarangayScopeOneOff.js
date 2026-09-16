import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { resolveBarangayKey } from "../config/barangays.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { dbName: "etelly" });
  const alertsCol = mongoose.connection.db.collection("alerts");
  const reportsCol = mongoose.connection.db.collection("emergency_reports");

  const broken = await alertsCol
    .find({ isActive: true, barangays: { $size: 0 } })
    .toArray();

  console.log(`Found ${broken.length} active citywide (barangays: []) alert(s):`);
  for (const a of broken) {
    console.log(`- [${a.type}] "${a.title}" @ "${a.location}"`);
  }

  for (const a of broken) {
    const key = resolveBarangayKey(a.location);
    if (!key) {
      console.log(`  SKIP (no resolvable barangay): ${a.title}`);
      continue;
    }
    await alertsCol.updateOne({ _id: a._id }, { $set: { barangays: [key] } });
    console.log(`  FIXED alert "${a.title}" -> barangays: ["${key}"]`);

    if (a.linkedReportId) {
      const report = await reportsCol.findOne({ _id: a.linkedReportId });
      if (report) {
        await reportsCol.updateOne(
          { _id: a.linkedReportId },
          { $set: { barangayKey: key, reporterBarangayKey: key } },
        );
        console.log(`  FIXED linked report ${a.linkedReportId} -> barangayKey/reporterBarangayKey: "${key}"`);
      }
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
