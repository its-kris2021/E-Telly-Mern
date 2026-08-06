/**
 * scripts/importHistoricalReports.js
 *
 * One-off import: loads the historical situational-report dataset
 * (data/Capstone_Antipolo-Dataset.xlsx — one sheet per year, columns
 * Date | Disaster Type | Severity | Barangay | Location) into the same
 * `emergency_reports` collection live mobile reports land in, as
 * status:"approved" rows. This is what makes them count as labels for
 * scripts/buildTrainingSet.js — no separate historical-data code path,
 * the risk model can't tell these apart from any other approved report.
 *
 * Marked with importSource:"historical_excel_import" (not reusing the
 * existing `source` field, which already means "online"/"offline" mesh
 * relay origin) purely so this batch is identifiable/reversible later —
 * never read by the training pipeline.
 *
 * Run manually:
 *   node scripts/importHistoricalReports.js [path-to-xlsx] [--dry-run] [--force]
 *
 * Defaults to data/Capstone_Antipolo-Dataset.xlsx. --dry-run prints the
 * would-be summary without writing. --force wipes a previous import batch
 * (matched by importSource) before re-importing, for a clean re-run.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import ExcelJS from "exceljs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { BARANGAY_COORDS, resolveBarangayKey } from "../config/barangays.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const IMPORT_SOURCE = "historical_excel_import";

// Handles spellings the dataset uses that resolveBarangayKey's generic
// normalization doesn't catch ("Sta Cruz" -> "stacruz", which doesn't
// contain/isn't contained by the canonical "santacruz" key).
const BARANGAY_TEXT_ALIASES = {
  "sta cruz": "santacruz",
  "sta. cruz": "santacruz",
  "santa cruz": "santacruz",
};

function resolveHistoricalBarangay(raw) {
  const cleaned = String(raw).trim().toLowerCase();
  if (BARANGAY_TEXT_ALIASES[cleaned]) return BARANGAY_TEXT_ALIASES[cleaned];
  return resolveBarangayKey(raw);
}

// A handful of rows list more than one affected barangay ("Dalig/San Jose") —
// split into one report per barangay so each barangay-day gets its own label.
function splitBarangays(raw) {
  if (!raw) return [];
  return String(raw)
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

// City-wide typhoon/storm-name rows ("Typhoon ROLLY") carry no barangay and
// aren't one of the app's emergencyType categories — not usable as a
// per-barangay training label, so they're skipped, not misfiled as "other".
function mapEmergencyType(raw) {
  const t = String(raw || "").toLowerCase();
  if (t.includes("landslide")) return "landslide";
  if (t.includes("flood")) return "flood"; // covers Flood, Flashflood, Creek Overflow Flood
  if (t.includes("fire")) return "fire";
  return null;
}

function excelCellText(cell) {
  const v = cell?.value;
  if (v == null) return null;
  if (typeof v === "object" && "text" in v) return v.text; // rich text
  if (typeof v === "object" && v instanceof Date) return v;
  return v;
}

async function parseWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const rows = [];
  const skipped = { noDate: 0, noBarangay: 0, notMappedType: 0, unresolvedBarangay: 0 };
  const unresolvedBarangayValues = new Set();

  for (const sheet of workbook.worksheets) {
    // Row 1 is the sheet's year banner; row 2 has the real column headers.
    const headerRow = sheet.getRow(2);
    const colIndex = {};
    headerRow.eachCell((cell, colNumber) => {
      const label = String(cell.value || "").trim().toLowerCase();
      colIndex[label] = colNumber;
    });
    if (!colIndex["date"] || !colIndex["disaster type"] || !colIndex["barangay"]) continue;

    for (let r = 3; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      if (row.actualCellCount === 0) continue;

      const dateVal = excelCellText(row.getCell(colIndex["date"]));
      const disasterTypeRaw = excelCellText(row.getCell(colIndex["disaster type"]));
      const severityRaw = colIndex["severity"] ? excelCellText(row.getCell(colIndex["severity"])) : null;
      const barangayRaw = excelCellText(row.getCell(colIndex["barangay"]));
      const locationRaw = colIndex["location"] ? excelCellText(row.getCell(colIndex["location"])) : null;

      if (!dateVal) { skipped.noDate++; continue; }
      const timestamp = dateVal instanceof Date ? dateVal : new Date(dateVal);
      if (Number.isNaN(timestamp.getTime())) { skipped.noDate++; continue; }

      if (!barangayRaw) { skipped.noBarangay++; continue; }

      const emergencyType = mapEmergencyType(disasterTypeRaw);
      if (!emergencyType) { skipped.notMappedType++; continue; }

      for (const piece of splitBarangays(barangayRaw)) {
        const barangayKey = resolveHistoricalBarangay(piece);
        if (!barangayKey) {
          skipped.unresolvedBarangay++;
          unresolvedBarangayValues.add(piece);
          continue;
        }
        const coord = BARANGAY_COORDS[barangayKey];
        rows.push({
          emergencyType,
          severity: severityRaw ? String(severityRaw) : "Historical record (severity not specified)",
          description: `Historical record: ${disasterTypeRaw}${locationRaw ? " — " + locationRaw : ""}`,
          location: locationRaw ? String(locationRaw) : "",
          barangay: barangayKey,
          latitude: coord.lat,
          longitude: coord.lng,
          userName: "Historical Import",
          phoneNumber: null,
          images: [],
          status: "approved",
          timestamp,
          importSource: IMPORT_SOURCE,
          importedAt: new Date(),
        });
      }
    }
  }

  return { rows, skipped, unresolvedBarangayValues };
}

async function run() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const filePath = args.find((a) => !a.startsWith("--")) || join(__dirname, "../data/Capstone_Antipolo-Dataset.xlsx");

  console.log(`Reading ${filePath} ...`);
  const { rows, skipped, unresolvedBarangayValues } = await parseWorkbook(filePath);

  const byType = rows.reduce((acc, r) => { acc[r.emergencyType] = (acc[r.emergencyType] || 0) + 1; return acc; }, {});
  console.log(`Parsed ${rows.length} importable report(s): ${JSON.stringify(byType)}`);
  console.log(
    `Skipped — no date: ${skipped.noDate}, no barangay: ${skipped.noBarangay}, ` +
    `type not mapped (e.g. typhoon advisories): ${skipped.notMappedType}, ` +
    `unresolved barangay text: ${skipped.unresolvedBarangay}`,
  );
  if (unresolvedBarangayValues.size > 0) {
    console.log(`  Unresolved barangay values (fix aliases in this script if these should map): ${[...unresolvedBarangayValues].join(", ")}`);
  }

  if (dryRun) {
    console.log("--dry-run set — no database writes made.");
    return;
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB...");

  const col = mongoose.connection.db.collection("emergency_reports");
  const existing = await col.countDocuments({ importSource: IMPORT_SOURCE });

  if (existing > 0) {
    if (!force) {
      console.log(
        `${existing} report(s) from a previous historical import already exist. ` +
        `Re-run with --force to delete and re-import, or leave as-is.`,
      );
      await mongoose.disconnect();
      return;
    }
    const { deletedCount } = await col.deleteMany({ importSource: IMPORT_SOURCE });
    console.log(`--force set — removed ${deletedCount} previously-imported report(s).`);
  }

  if (rows.length > 0) {
    const { insertedCount } = await col.insertMany(rows, { ordered: false });
    console.log(`Inserted ${insertedCount} historical report(s) into emergency_reports.`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
