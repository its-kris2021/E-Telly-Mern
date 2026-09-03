import request from "supertest";
import mongoose from "mongoose";
import { startTestDb, stopTestDb, clearTestDb } from "./helpers/testDb.js";
import { buildTestApp } from "./helpers/testApp.js";
import { makeToken } from "./helpers/auth.js";
import User from "../models/user.js";
import Alert from "../models/Alert.js";
import EvacuationLog from "../models/EvacuationLog.js";

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

async function seedUser(overrides) {
  return User.create({
    name: "Test User",
    email: `${new mongoose.Types.ObjectId()}@example.com`,
    password: "x",
    role: "user",
    ...overrides,
  });
}

async function seedMessage({ senderId, receiverId, text = "hello", timestamp = new Date() }) {
  const { insertedId } = await mongoose.connection.db
    .collection("messages")
    .insertOne({ senderId, receiverId, text, timestamp, read: false });
  return insertedId;
}

// Dismissing a reported chat case writes one entry into ChatModerationCase.logs[]
// (domain: chat_case) AND one into ChatUserModerationProfile.history[] (domain:
// chat_user) — a single action, two domains, convenient for seeding both at once.
async function seedChatDismissal() {
  const sender = await seedUser({ address: "Bagong Nayon" });
  const reporter = await seedUser();
  const messageId = await seedMessage({ senderId: sender._id, receiverId: reporter._id });
  await request(app)
    .post("/api/message-reports")
    .set("Authorization", `Bearer ${makeToken({ id: reporter._id.toString(), role: "user" })}`)
    .send({ messageId: messageId.toString(), reason: "scam_spam" });

  const adminToken = makeToken({ id: new mongoose.Types.ObjectId().toString(), name: "Admin Cruz", role: "system_admin" });
  await request(app)
    .patch(`/api/chat-monitoring/cases/${messageId}/status`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "dismissed", note: "Not a violation." });
}

async function seedEmergencyReportLog() {
  const { insertedId } = await mongoose.connection.db.collection("emergency_reports").insertOne({
    emergencyType: "flood",
    severity: "high",
    status: "resolved",
    timestamp: new Date(),
    logs: [{ action: "resolved", by: "Officer Reyes", at: new Date(), notes: "Handled on-site." }],
  });
  return insertedId;
}

async function seedAlertLog() {
  return Alert.create({
    source: "CDRRMO",
    type: "flood",
    severity: "warning",
    title: "Flood Warning — Bagong Nayon",
    description: "Rising water levels reported.",
    actionLog: [{ action: "dismissed", by: "Officer Santos", at: new Date() }],
  });
}

async function seedEvacuationLog() {
  return EvacuationLog.create({
    centerId: new mongoose.Types.ObjectId(),
    centerName: "Bagong Nayon Elementary School",
    barangay: "bagongnayon",
    action: "occupancy_update",
    previousValue: 10,
    newValue: 25,
    delta: 15,
    user: { id: new mongoose.Types.ObjectId(), name: "Officer Dizon" },
  });
}

describe("GET /api/audit-logs — role gating", () => {
  test("rejects requests with no token", async () => {
    const res = await request(app).get("/api/audit-logs");
    expect(res.status).toBe(401);
  });

  test.each(["cdrrmo", "barangay_official", "user"])("rejects %s", async (role) => {
    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role, assignedBarangay: role === "barangay_official" ? "bagongnayon" : null });
    const res = await request(app).get("/api/audit-logs").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test("allows system_admin", async () => {
    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "system_admin" });
    const res = await request(app).get("/api/audit-logs").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/audit-logs — aggregation across all five domains", () => {
  test("surfaces entries from chat cases, chat user profiles, reports, alerts, and evacuation logs", async () => {
    await seedChatDismissal();
    await seedEmergencyReportLog();
    await seedAlertLog();
    await seedEvacuationLog();

    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "system_admin" });
    const res = await request(app).get("/api/audit-logs?limit=100").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const domains = res.body.entries.map((e) => e.domain);
    expect(new Set(domains)).toEqual(
      new Set(["chat_case", "chat_user", "emergency_report", "alert", "evacuation"]),
    );

    const evacEntry = res.body.entries.find((e) => e.domain === "evacuation");
    expect(evacEntry.actorName).toBe("Officer Dizon");
    expect(evacEntry.target.label).toBe("Bagong Nayon Elementary School");
    expect(evacEntry.notes).toBe("10 → 25");

    const alertEntry = res.body.entries.find((e) => e.domain === "alert");
    expect(alertEntry.actorName).toBe("Officer Santos");
    expect(alertEntry.action).toBe("dismissed");

    const reportEntry = res.body.entries.find((e) => e.domain === "emergency_report");
    expect(reportEntry.actorName).toBe("Officer Reyes");

    const chatCaseEntry = res.body.entries.find((e) => e.domain === "chat_case");
    expect(chatCaseEntry.action).toBe("status_change");
    expect(chatCaseEntry.actorName).toBe("Admin Cruz");

    const chatUserEntry = res.body.entries.find((e) => e.domain === "chat_user");
    expect(chatUserEntry.action).toBe("case_dismissed");
  });

  test("entries are sorted newest-first across domains", async () => {
    await EvacuationLog.create({
      centerId: new mongoose.Types.ObjectId(),
      centerName: "Older Center",
      barangay: "bagongnayon",
      action: "occupancy_update",
      previousValue: 0,
      newValue: 1,
      delta: 1,
      user: { id: new mongoose.Types.ObjectId(), name: "Someone" },
      createdAt: new Date(Date.now() - 60_000),
    });
    await seedAlertLog(); // created "now", should sort before the older evacuation entry

    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "system_admin" });
    const res = await request(app).get("/api/audit-logs").set("Authorization", `Bearer ${token}`);

    const timestamps = res.body.entries.map((e) => new Date(e.at).getTime());
    const sorted = [...timestamps].sort((a, b) => b - a);
    expect(timestamps).toEqual(sorted);
  });

  test("domain filter returns only that domain's entries", async () => {
    await seedAlertLog();
    await seedEvacuationLog();

    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "system_admin" });
    const res = await request(app).get("/api/audit-logs?domain=alert").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeGreaterThan(0);
    expect(res.body.entries.every((e) => e.domain === "alert")).toBe(true);
  });

  test("rejects an invalid domain", async () => {
    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "system_admin" });
    const res = await request(app).get("/api/audit-logs?domain=not_a_domain").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  test("search filter matches actor name, target label, and action", async () => {
    await seedEvacuationLog();
    await seedAlertLog();

    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "system_admin" });

    const byActor = await request(app).get("/api/audit-logs?search=Dizon").set("Authorization", `Bearer ${token}`);
    expect(byActor.body.entries).toHaveLength(1);
    expect(byActor.body.entries[0].domain).toBe("evacuation");

    const byTarget = await request(app).get("/api/audit-logs?search=Bagong Nayon Elementary").set("Authorization", `Bearer ${token}`);
    expect(byTarget.body.entries).toHaveLength(1);

    const byAction = await request(app).get("/api/audit-logs?search=dismissed").set("Authorization", `Bearer ${token}`);
    expect(byAction.body.entries.some((e) => e.domain === "alert")).toBe(true);
  });

  test("pagination slices results and reports the correct total", async () => {
    for (let i = 0; i < 5; i++) {
      await EvacuationLog.create({
        centerId: new mongoose.Types.ObjectId(),
        centerName: `Center ${i}`,
        barangay: "bagongnayon",
        action: "occupancy_update",
        previousValue: 0,
        newValue: 1,
        delta: 1,
        user: { id: new mongoose.Types.ObjectId(), name: "Officer Dizon" },
      });
    }

    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "system_admin" });
    const res = await request(app)
      .get("/api/audit-logs?domain=evacuation&page=1&limit=2")
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.entries).toHaveLength(2);
    expect(res.body.total).toBe(5);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(2);
  });
});

describe("Regression: report status routes record the authenticated actor, not client input", () => {
  // server/index.js's /api/reports/update-status and /api/reports/resolve are
  // not mounted in the lightweight test app (see helpers/testApp.js) since
  // that file boots a real DB connection + Socket.IO as an import side
  // effect. This asserts the fix directly against the source instead: the
  // routes must never read reviewedBy/resolvedBy/adminEmail identity from
  // req.body.
  test("update-status and resolve handlers don't read actor identity from req.body", async () => {
    const fs = await import("fs");
    const indexSrc = fs.readFileSync(new URL("../index.js", import.meta.url), "utf8");

    const updateStatusBlock = indexSrc.slice(
      indexSrc.indexOf('"/api/reports/update-status"'),
      indexSrc.indexOf('"/api/reports/resolve"'),
    );
    const resolveBlock = indexSrc.slice(indexSrc.indexOf('"/api/reports/resolve"'));

    expect(updateStatusBlock).not.toMatch(/reviewedBy:\s*adminEmail/);
    expect(updateStatusBlock).toMatch(/reviewedBy:\s*actorName/);
    expect(resolveBlock.slice(0, 2000)).not.toMatch(/resolvedBy:\s*resolvedBy\s*\|\|/);
    expect(resolveBlock.slice(0, 2000)).toMatch(/resolvedBy:\s*actorName/);
  });
});
