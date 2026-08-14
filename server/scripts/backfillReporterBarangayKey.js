/**
 * scripts/backfillReporterBarangayKey.js
 *
 * One-off backfill: sets reporterBarangayKey on emergency_reports documents
 * that predate the mobile-app direct-MongoDB-write bypass fix (see
 * etelly-mobile/lib/services/internet_checker_service.dart) and so never
 * went through POST /api/reports/create, the only place reporterBarangayKey
 * is normally resolved (routes/reports.js). Without it, a report is
 * invisible to every barangay_official — only CDRRMO (unscoped) sees it.
 *
 * Scope is intentionally narrow: only reports where the reporter's identity
 * is unambiguous are touched.
 *   - email is read from the top-level `reporterEmail` field if present,
 *     falling back to `userData.email` — bypass-written reports never got
 *     the top-level field synthesized (that only happens inside
 *     POST /api/reports/create), so in practice this backfill's real
 *     matches all come from `userData.email`.
 *   - the email must match an existing `users` document.
 *   - that user's `barangay` (falling back to `address`) must resolve to a
 *     known key via the exact same resolveBarangayKey() heuristic
 *     production code already uses.
 * Anything that fails any of those steps is left untouched — no guessing,
 * no partial matches. Historical-import rows, admin-created alert-linked
 * reports, and reports with no resolvable reporter are all expected to be
 * skipped; that's by design, not a bug in this script (see the read-only
 * investigation this was built from — 397 historical + 2 alert-linked + 1
 * with a literal "anonymous" email, none of which have a real user to
 * match against).
 *
 * Defaults to dry-run — prints exactly what would change without writing
 * anything. Pass --apply to actually perform the updates.
 *
 * Run manually:
 *   node scripts/backfillReporterBarangayKey.js            # dry-run
 *   node scripts/backfillReporterBarangayKey.js --apply     # writes
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { resolveBarangayKey } from "../config/barangays.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const PLACEHOLDER_EMAILS = new Set(["no-email@example.com", "anonymous", ""]);

async function run() {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to MongoDB... (${apply ? "APPLY — will write" : "DRY RUN — no writes"})\n`);

  const reportsCol = mongoose.connection.db.collection("emergency_reports");
  const usersCol = mongoose.connection.db.collection("users");

  const candidates = await reportsCol
    .find({ reporterBarangayKey: { $in: [null, undefined] } })
    .project({ reporterEmail: 1, userData: 1, emergencyType: 1, status: 1, timestamp: 1 })
    .toArray();

  const userCache = new Map();
  async function findUserByEmail(email) {
    if (userCache.has(email)) return userCache.get(email);
    const user = await usersCol.findOne(
      { email },
      { projection: { email: 1, barangay: 1, address: 1 } },
    );
    userCache.set(email, user);
    return user;
  }

  const toBackfill = [];
  let skippedNoEmail = 0;
  let skippedNoUser = 0;
  let skippedUnresolvable = 0;

  for (const report of candidates) {
    const rawEmail = report.reporterEmail || report.userData?.email || "";
    const email = String(rawEmail).trim().toLowerCase();

    if (!email || PLACEHOLDER_EMAILS.has(email)) {
      skippedNoEmail++;
      continue;
    }

    const user = await findUserByEmail(email);
    if (!user) {
      skippedNoUser++;
      continue;
    }

    const resolvedBarangayKey = resolveBarangayKey(user.barangay) ?? resolveBarangayKey(user.address);
    if (!resolvedBarangayKey) {
      skippedUnresolvable++;
      continue;
    }

    toBackfill.push({
      _id: report._id,
      email,
      emergencyType: report.emergencyType,
      status: report.status,
      timestamp: report.timestamp,
      resolvedBarangayKey,
    });
  }

  console.log(`Reports missing reporterBarangayKey: ${candidates.length}`);
  console.log(`  Backfillable (unambiguous email -> user -> resolvable barangay): ${toBackfill.length}`);
  console.log(`  Skipped — no usable reporter email:  ${skippedNoEmail}`);
  console.log(`  Skipped — email has no matching user: ${skippedNoUser}`);
  console.log(`  Skipped — user found, barangay unresolvable: ${skippedUnresolvable}\n`);

  console.log("── Proposed changes ─────────────────────────────────────────");
  for (const r of toBackfill) {
    console.log(
      `${r._id}  ${r.email.padEnd(32)} ${String(r.emergencyType || "").padEnd(10)} ` +
      `${String(r.status || "").padEnd(10)} ${r.timestamp}  ->  reporterBarangayKey: ${r.resolvedBarangayKey}`,
    );
  }
  console.log("");

  if (!apply) {
    console.log("Dry run only — no database writes made. Re-run with --apply to write these changes.");
    await mongoose.disconnect();
    process.exit(0);
  }

  let updated = 0;
  for (const r of toBackfill) {
    const result = await reportsCol.updateOne(
      { _id: r._id, reporterBarangayKey: { $in: [null, undefined] } },
      { $set: { reporterBarangayKey: r.resolvedBarangayKey } },
    );
    if (result.modifiedCount > 0) updated++;
  }
  console.log(`✅ Updated ${updated} / ${toBackfill.length} report(s).`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
