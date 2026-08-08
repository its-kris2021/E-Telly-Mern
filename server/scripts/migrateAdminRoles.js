/**
 * scripts/migrateAdminRoles.js
 *
 * One-off, human-run migration for the System Admin / CDRRMO role split.
 * Every existing role:"admin" account must become either "system_admin"
 * (web-platform/account management only) or "cdrrmo" (full disaster-ops) —
 * this is a policy decision only a human can make, so this script refuses
 * to guess.
 *
 * Usage:
 *   node scripts/migrateAdminRoles.js
 *     Lists every role:"admin" user (id, name, email, createdAt) and exits
 *     without changing anything.
 *
 *   node scripts/migrateAdminRoles.js --map='{"<userId>":"system_admin","<userId2>":"cdrrmo"}'
 *     Applies exactly that mapping. Refuses to run (exits non-zero) if any
 *     existing role:"admin" user is left unmapped, or if a mapped value
 *     isn't "system_admin"/"cdrrmo".
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import User from "../models/user.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const mapArg = process.argv.find((arg) => arg.startsWith("--map="));

await mongoose.connect(process.env.MONGO_URI);
console.log("Connected to MongoDB...");

const admins = await User.find({ role: "admin" }).select("_id name email createdAt");

if (admins.length === 0) {
  console.log("No role:\"admin\" users remain — nothing to migrate.");
  await mongoose.disconnect();
  process.exit(0);
}

if (!mapArg) {
  console.log(`Found ${admins.length} role:"admin" user(s):\n`);
  for (const u of admins) {
    console.log(`  ${u._id}  ${u.email.padEnd(32)}  ${u.name.padEnd(24)}  created ${u.createdAt.toISOString()}`);
  }
  console.log(
    `\nRe-run with --map='{"<id>":"system_admin"|"cdrrmo", ...}' covering every id above to apply.`,
  );
  await mongoose.disconnect();
  process.exit(0);
}

let mapping;
try {
  mapping = JSON.parse(mapArg.slice("--map=".length));
} catch (err) {
  console.error("✗ --map must be valid JSON:", err.message);
  await mongoose.disconnect();
  process.exit(1);
}

const VALID_TARGETS = new Set(["system_admin", "cdrrmo"]);
const unmapped = admins.filter((u) => !mapping[u._id.toString()]);
const invalid = Object.entries(mapping).filter(([, role]) => !VALID_TARGETS.has(role));

if (unmapped.length > 0) {
  console.error(`✗ ${unmapped.length} admin user(s) left unmapped:`);
  for (const u of unmapped) console.error(`    ${u._id}  ${u.email}`);
  await mongoose.disconnect();
  process.exit(1);
}
if (invalid.length > 0) {
  console.error(`✗ Invalid target role(s) in --map (must be "system_admin" or "cdrrmo"):`);
  for (const [id, role] of invalid) console.error(`    ${id} → "${role}"`);
  await mongoose.disconnect();
  process.exit(1);
}

for (const u of admins) {
  const newRole = mapping[u._id.toString()];
  await User.updateOne({ _id: u._id }, { role: newRole });
  console.log(`  ${u.email.padEnd(32)}  admin → ${newRole}`);
}

console.log(`\n✅ Migrated ${admins.length} account(s).`);
await mongoose.disconnect();
process.exit(0);
