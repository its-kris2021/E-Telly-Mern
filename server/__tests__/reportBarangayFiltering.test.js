import request from "supertest";
import mongoose from "mongoose";
import { startTestDb, stopTestDb, clearTestDb } from "./helpers/testDb.js";
import { buildTestApp } from "./helpers/testApp.js";
import { makeToken } from "./helpers/auth.js";
import { scopeToAssignedBarangay, rejectIfOutsideAssignedBarangay } from "../middleware/auth.js";
import { BARANGAY_KEYS, BARANGAY_LABELS, resolveBarangayKey } from "../config/barangays.js";

let app;

beforeAll(async () => {
  await startTestDb();
  app = buildTestApp();
}, 60000);

afterAll(async () => {
  await stopTestDb();
});

afterEach(async () => {
  await clearTestDb();
});

async function seedReport(reporterBarangayKey, extra = {}) {
  const { insertedId } = await mongoose.connection.db.collection("emergency_reports").insertOne({
    emergencyType: "flood",
    severity: "high",
    status: "pending",
    timestamp: new Date(),
    reporterBarangayKey,
    ...extra,
  });
  return insertedId;
}

// ── Pure-function coverage across every real barangay key, not just the
// three (sanroque/bagongnayon/santacruz) that happened to show up in the
// backfill data — proves the scoping logic itself is generic, independent
// of which barangays actually have reports right now.
describe("scopeToAssignedBarangay — generic across every barangay key", () => {
  test.each(BARANGAY_KEYS)("barangay_official assigned to %s is scoped to exactly that key", (key) => {
    const req = { user: { role: "barangay_official", assignedBarangay: key } };
    expect(scopeToAssignedBarangay(req, "reporterBarangayKey")).toEqual({ reporterBarangayKey: key });
  });

  test.each(["cdrrmo", "system_admin"])("%s is never scoped, regardless of assignedBarangay", (role) => {
    for (const key of BARANGAY_KEYS) {
      const req = { user: { role, assignedBarangay: key } };
      expect(scopeToAssignedBarangay(req, "reporterBarangayKey")).toEqual({});
    }
  });
});

describe("rejectIfOutsideAssignedBarangay — generic across every barangay key", () => {
  test.each(BARANGAY_KEYS)("barangay_official assigned to %s is rejected for every other key", (key) => {
    const req = { user: { role: "barangay_official", assignedBarangay: key } };
    for (const otherKey of BARANGAY_KEYS) {
      if (otherKey === key) continue;
      const res = { status: () => res, json: () => {} };
      expect(rejectIfOutsideAssignedBarangay(req, res, otherKey)).toBe(true);
    }
    const res = { status: () => res, json: () => {} };
    expect(rejectIfOutsideAssignedBarangay(req, res, key)).toBe(false);
  });
});

describe("resolveBarangayKey — every barangay's human label normalizes back to its own key", () => {
  test.each(BARANGAY_KEYS)("%s", (key) => {
    const label = BARANGAY_LABELS[key];
    expect(resolveBarangayKey(label)).toBe(key);
    expect(resolveBarangayKey(label.toUpperCase())).toBe(key);
    expect(resolveBarangayKey(`Brgy. ${label}`)).toBe(key);
    expect(resolveBarangayKey(`Barangay ${label}`)).toBe(key);
  });
});

// ── End-to-end HTTP coverage: real Express route + real (in-memory) Mongo
// query, across multiple distinct barangays that were NOT part of the
// earlier manual backfill (sanjuan, calawis, mayamot, dalig) — proving the
// filtering isn't coincidentally correct only for the three barangays that
// showed up in that data.
describe("GET /api/reports — dynamic per-barangay filtering (integration)", () => {
  test("each barangay_official sees only reports matching their own assignedBarangay", async () => {
    const sanjuanReport = await seedReport("sanjuan");
    const calawisReport = await seedReport("calawis");
    const mayamotReport = await seedReport("mayamot");
    await seedReport("dalig");
    await seedReport(null); // no reporter identity — unresolved, must never surface to any official

    const sanjuanToken = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "barangay_official", assignedBarangay: "sanjuan" });
    const sanjuanRes = await request(app).get("/api/reports").set("Authorization", `Bearer ${sanjuanToken}`);
    expect(sanjuanRes.status).toBe(200);
    expect(sanjuanRes.body.reports.map((r) => r._id)).toEqual([String(sanjuanReport)]);

    const calawisToken = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "barangay_official", assignedBarangay: "calawis" });
    const calawisRes = await request(app).get("/api/reports").set("Authorization", `Bearer ${calawisToken}`);
    expect(calawisRes.body.reports.map((r) => r._id)).toEqual([String(calawisReport)]);

    const mayamotToken = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "barangay_official", assignedBarangay: "mayamot" });
    const mayamotRes = await request(app).get("/api/reports").set("Authorization", `Bearer ${mayamotToken}`);
    expect(mayamotRes.body.reports.map((r) => r._id)).toEqual([String(mayamotReport)]);
  });

  test("a barangay_official assigned to a barangay with zero reports gets an empty list, not an error", async () => {
    await seedReport("sanjuan");

    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "barangay_official", assignedBarangay: "muntindilaw" });
    const res = await request(app).get("/api/reports").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.reports).toEqual([]);
  });

  test("cdrrmo sees every report across every barangay, unscoped", async () => {
    await seedReport("sanjuan");
    await seedReport("calawis");
    await seedReport("mayamot");
    await seedReport("dalig");
    await seedReport(null);

    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "cdrrmo" });
    const res = await request(app).get("/api/reports").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.reports).toHaveLength(5);
  });

  test("system_admin also sees every report, unscoped", async () => {
    await seedReport("sanjuan");
    await seedReport("dalig");

    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "system_admin" });
    const res = await request(app).get("/api/reports").set("Authorization", `Bearer ${token}`);
    expect(res.body.reports).toHaveLength(2);
  });

  test("a barangay_official with no assignedBarangay on their account is rejected before any query runs", async () => {
    await seedReport("sanjuan");

    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "barangay_official", assignedBarangay: null });
    const res = await request(app).get("/api/reports").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test("reports with no reporterBarangayKey never surface to any barangay_official", async () => {
    await seedReport(null);
    // A report missing the field entirely (predates the field existing at
    // all), not just set to null — must be equally invisible.
    await mongoose.connection.db.collection("emergency_reports").insertOne({
      emergencyType: "fire",
      severity: "high",
      status: "pending",
      timestamp: new Date(),
    });

    for (const key of ["sanjuan", "calawis", "mayamot"]) {
      const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "barangay_official", assignedBarangay: key });
      const res = await request(app).get("/api/reports").set("Authorization", `Bearer ${token}`);
      expect(res.body.reports).toEqual([]);
    }
  });
});
