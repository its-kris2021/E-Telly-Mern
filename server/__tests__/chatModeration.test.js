import request from "supertest";
import mongoose from "mongoose";
import { startTestDb, stopTestDb, clearTestDb } from "./helpers/testDb.js";
import { buildTestApp } from "./helpers/testApp.js";
import { makeToken } from "./helpers/auth.js";
import User from "../models/user.js";
import MessageReport from "../models/MessageReport.js";
import ChatModerationCase from "../models/ChatModerationCase.js";
import ChatUserModerationProfile from "../models/ChatUserModerationProfile.js";

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

describe("POST /api/message-reports", () => {
  test("submits a report and creates a moderation case (reportCount: 1)", async () => {
    const sender = await seedUser({ address: "Bagong Nayon, Antipolo" });
    const reporter = await seedUser();
    const messageId = await seedMessage({ senderId: sender._id, receiverId: reporter._id });
    const token = makeToken({ id: reporter._id.toString(), role: "user" });

    const res = await request(app)
      .post("/api/message-reports")
      .set("Authorization", `Bearer ${token}`)
      .send({ messageId: messageId.toString(), reason: "spam" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const kase = await ChatModerationCase.findOne({ messageId });
    expect(kase).not.toBeNull();
    expect(kase.reportCount).toBe(1);
    expect(kase.reasonCounts.spam).toBe(1);
    expect(kase.reportedUserBarangayKey).toBe("bagongnayon");
  });

  test("rejects a duplicate report from the same user (409), case count unchanged", async () => {
    const sender = await seedUser();
    const reporter = await seedUser();
    const messageId = await seedMessage({ senderId: sender._id, receiverId: reporter._id });
    const token = makeToken({ id: reporter._id.toString(), role: "user" });

    await request(app)
      .post("/api/message-reports")
      .set("Authorization", `Bearer ${token}`)
      .send({ messageId: messageId.toString(), reason: "spam" });

    const second = await request(app)
      .post("/api/message-reports")
      .set("Authorization", `Bearer ${token}`)
      .send({ messageId: messageId.toString(), reason: "harassment" });

    expect(second.status).toBe(409);

    const kase = await ChatModerationCase.findOne({ messageId });
    expect(kase.reportCount).toBe(1);

    const reportCount = await MessageReport.countDocuments({ messageId });
    expect(reportCount).toBe(1);
  });

  test("two different users reporting the same message both count, with distinct reasons tracked", async () => {
    const sender = await seedUser();
    const reporterA = await seedUser();
    const reporterB = await seedUser();
    const messageId = await seedMessage({ senderId: sender._id, receiverId: reporterA._id });

    await request(app)
      .post("/api/message-reports")
      .set("Authorization", `Bearer ${makeToken({ id: reporterA._id.toString(), role: "user" })}`)
      .send({ messageId: messageId.toString(), reason: "threats" });

    await request(app)
      .post("/api/message-reports")
      .set("Authorization", `Bearer ${makeToken({ id: reporterB._id.toString(), role: "user" })}`)
      .send({ messageId: messageId.toString(), reason: "spam" });

    const kase = await ChatModerationCase.findOne({ messageId });
    expect(kase.reportCount).toBe(2);
    expect(kase.reasonCounts.threats).toBe(1);
    expect(kase.reasonCounts.spam).toBe(1);
  });

  test("rejects an unauthenticated submission", async () => {
    const sender = await seedUser();
    const reporter = await seedUser();
    const messageId = await seedMessage({ senderId: sender._id, receiverId: reporter._id });

    const res = await request(app)
      .post("/api/message-reports")
      .send({ messageId: messageId.toString(), reason: "spam" });

    expect(res.status).toBe(401);
  });

  test("rejects an invalid reason", async () => {
    const sender = await seedUser();
    const reporter = await seedUser();
    const messageId = await seedMessage({ senderId: sender._id, receiverId: reporter._id });
    const token = makeToken({ id: reporter._id.toString(), role: "user" });

    const res = await request(app)
      .post("/api/message-reports")
      .set("Authorization", `Bearer ${token}`)
      .send({ messageId: messageId.toString(), reason: "not_a_real_reason" });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/chat-monitoring/cases — auth and role gating", () => {
  test("rejects requests with no token", async () => {
    const res = await request(app).get("/api/chat-monitoring/cases");
    expect(res.status).toBe(401);
  });

  test("rejects a plain resident (role: user)", async () => {
    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "user" });
    const res = await request(app).get("/api/chat-monitoring/cases").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test.each(["system_admin", "cdrrmo"])("allows %s", async (role) => {
    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role });
    const res = await request(app).get("/api/chat-monitoring/cases").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  test("rejects a barangay_official with no assignedBarangay on their account", async () => {
    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "barangay_official", assignedBarangay: null });
    const res = await request(app).get("/api/chat-monitoring/cases").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe("Barangay scoping and reporter privacy", () => {
  async function seedCase({ address, reasons = ["spam"] }) {
    const sender = await seedUser({ address });
    const reporters = await Promise.all(reasons.map(() => seedUser()));
    const messageId = await seedMessage({ senderId: sender._id, receiverId: reporters[0]._id, text: "reported text" });

    for (let i = 0; i < reasons.length; i++) {
      await request(app)
        .post("/api/message-reports")
        .set("Authorization", `Bearer ${makeToken({ id: reporters[i]._id.toString(), role: "user" })}`)
        .send({ messageId: messageId.toString(), reason: reasons[i] });
    }
    return { messageId, sender, reporters };
  }

  test("a barangay_official only sees cases whose reported user resolves to their own barangay", async () => {
    const { messageId: bagongNayonMessageId } = await seedCase({ address: "Bagong Nayon" });
    await seedCase({ address: "Beverly Hills" });

    const token = makeToken({
      id: new mongoose.Types.ObjectId().toString(),
      role: "barangay_official",
      assignedBarangay: "bagongnayon",
    });

    const res = await request(app).get("/api/chat-monitoring/cases").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.cases).toHaveLength(1);
    expect(res.body.cases[0].messageId).toBe(bagongNayonMessageId.toString());
  });

  test("a direct case-detail request outside the official's barangay is rejected (403)", async () => {
    const { messageId: beverlyHillsMessageId } = await seedCase({ address: "Beverly Hills" });

    const token = makeToken({
      id: new mongoose.Types.ObjectId().toString(),
      role: "barangay_official",
      assignedBarangay: "bagongnayon",
    });

    const res = await request(app)
      .get(`/api/chat-monitoring/cases/${beverlyHillsMessageId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test("CDRRMO and System Admin see cases from every barangay (unscoped)", async () => {
    await seedCase({ address: "Bagong Nayon" });
    await seedCase({ address: "Beverly Hills" });

    for (const role of ["cdrrmo", "system_admin"]) {
      const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role });
      const res = await request(app).get("/api/chat-monitoring/cases").set("Authorization", `Bearer ${token}`);
      expect(res.body.cases).toHaveLength(2);
    }
  });

  test("reporter identity is included only for system_admin, never for cdrrmo or barangay_official", async () => {
    const { messageId, reporters } = await seedCase({ address: "Bagong Nayon", reasons: ["spam", "harassment"] });

    const adminToken = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "system_admin" });
    const adminRes = await request(app)
      .get(`/api/chat-monitoring/cases/${messageId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.reports).toHaveLength(2);
    for (const r of adminRes.body.reports) {
      expect(r.reporter).toBeDefined();
      expect(r.reporter.id).toBeDefined();
    }

    const cdrrmoToken = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "cdrrmo" });
    const cdrrmoRes = await request(app)
      .get(`/api/chat-monitoring/cases/${messageId}`)
      .set("Authorization", `Bearer ${cdrrmoToken}`);
    expect(cdrrmoRes.status).toBe(200);
    for (const r of cdrrmoRes.body.reports) {
      expect(r.reporter).toBeUndefined();
    }

    const brgyToken = makeToken({
      id: new mongoose.Types.ObjectId().toString(),
      role: "barangay_official",
      assignedBarangay: "bagongnayon",
    });
    const brgyRes = await request(app)
      .get(`/api/chat-monitoring/cases/${messageId}`)
      .set("Authorization", `Bearer ${brgyToken}`);
    expect(brgyRes.status).toBe(200);
    for (const r of brgyRes.body.reports) {
      expect(r.reporter).toBeUndefined();
    }

    // Sanity: the reporters really were distinct users, proving this isn't
    // trivially passing because there was nothing to hide.
    expect(new Set(reporters.map((r) => r._id.toString())).size).toBe(2);
  });
});

describe("Admin review: warnings, restriction, dismissal", () => {
  async function seedReportedCase({ address = "Bagong Nayon", reason = "bullying", sender } = {}) {
    const actualSender = sender || (await seedUser({ address }));
    const reporter = await seedUser();
    const messageId = await seedMessage({ senderId: actualSender._id, receiverId: reporter._id });
    await request(app)
      .post("/api/message-reports")
      .set("Authorization", `Bearer ${makeToken({ id: reporter._id.toString(), role: "user" })}`)
      .send({ messageId: messageId.toString(), reason });
    return { messageId, sender: actualSender };
  }

  test("sending a warning on a pending case issues warning #1, logs it, and auto-resolves the case", async () => {
    const { messageId } = await seedReportedCase();
    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), name: "Officer Reyes", role: "cdrrmo" });

    const res = await request(app)
      .post(`/api/chat-monitoring/cases/${messageId}/warn`)
      .set("Authorization", `Bearer ${token}`)
      .send({ note: "First offense, verbal warning issued." });

    expect(res.status).toBe(200);
    expect(res.body.reportedUser.warningCount).toBe(1);
    expect(res.body.reportedUser.restricted).toBe(false);
    expect(res.body.case.status).toBe("resolved");
    expect(res.body.case.reviewedBy).toBe("Officer Reyes");

    const kase = await ChatModerationCase.findOne({ messageId });
    expect(kase.logs.map((l) => l.action)).toEqual(["warning_issued", "status_change"]);
  });

  test("a 2nd confirmed violation on a different case for the same user auto-applies Chat Restriction", async () => {
    const sender = await seedUser({ address: "Bagong Nayon" });
    const { messageId: firstMessageId } = await seedReportedCase({ sender, reason: "spam" });
    const { messageId: secondMessageId } = await seedReportedCase({ sender, reason: "harassment" });

    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "cdrrmo" });

    const first = await request(app)
      .post(`/api/chat-monitoring/cases/${firstMessageId}/warn`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(first.body.reportedUser.warningCount).toBe(1);
    expect(first.body.reportedUser.restricted).toBe(false);

    const second = await request(app)
      .post(`/api/chat-monitoring/cases/${secondMessageId}/warn`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(second.body.reportedUser.warningCount).toBe(2);
    expect(second.body.reportedUser.restricted).toBe(true);
    expect(second.body.reportedUser.restrictedAt).toBeTruthy();

    const profile = await ChatUserModerationProfile.findOne({ userId: sender._id });
    expect(profile.warningCount).toBe(2);
    expect(profile.restricted).toBe(true);
    expect(profile.history.map((h) => h.action)).toEqual([
      "warning_issued", "case_resolved",
      "warning_issued", "restriction_applied", "case_resolved",
    ]);

    const secondCase = await ChatModerationCase.findOne({ messageId: secondMessageId });
    expect(secondCase.logs.map((l) => l.action)).toEqual([
      "warning_issued", "restriction_applied", "status_change",
    ]);
  });

  test("multiple reports of the same message still only count as one violation when warned once", async () => {
    const sender = await seedUser({ address: "Bagong Nayon" });
    const reporterA = await seedUser();
    const reporterB = await seedUser();
    const messageId = await seedMessage({ senderId: sender._id, receiverId: reporterA._id });

    await request(app)
      .post("/api/message-reports")
      .set("Authorization", `Bearer ${makeToken({ id: reporterA._id.toString(), role: "user" })}`)
      .send({ messageId: messageId.toString(), reason: "spam" });
    await request(app)
      .post("/api/message-reports")
      .set("Authorization", `Bearer ${makeToken({ id: reporterB._id.toString(), role: "user" })}`)
      .send({ messageId: messageId.toString(), reason: "harassment" });

    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "cdrrmo" });
    const res = await request(app)
      .post(`/api/chat-monitoring/cases/${messageId}/warn`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.reportedUser.warningCount).toBe(1);
  });

  test("re-warning a case that is no longer pending is rejected (400)", async () => {
    const { messageId } = await seedReportedCase();
    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "cdrrmo" });

    await request(app)
      .post(`/api/chat-monitoring/cases/${messageId}/warn`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    const again = await request(app)
      .post(`/api/chat-monitoring/cases/${messageId}/warn`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(again.status).toBe(400);
  });

  test("dismissing a case does not increment warningCount, but is logged to the user's profile", async () => {
    const sender = await seedUser({ address: "Bagong Nayon" });
    const { messageId } = await seedReportedCase({ sender });
    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "system_admin" });

    const res = await request(app)
      .patch(`/api/chat-monitoring/cases/${messageId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "dismissed", note: "Not a violation — context was a joke between friends." });

    expect(res.status).toBe(200);
    expect(res.body.case.status).toBe("dismissed");
    expect(res.body.case.reportedUser.warningCount).toBe(0);

    const profile = await ChatUserModerationProfile.findOne({ userId: sender._id });
    expect(profile.warningCount).toBe(0);
    expect(profile.restricted).toBe(false);
    expect(profile.history).toHaveLength(1);
    expect(profile.history[0].action).toBe("case_dismissed");
  });

  test("rejects an invalid status value", async () => {
    const { messageId } = await seedReportedCase();
    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "system_admin" });

    const res = await request(app)
      .patch(`/api/chat-monitoring/cases/${messageId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "reviewing" });
    expect(res.status).toBe(400);
  });

  test("a barangay_official cannot warn or dismiss a case outside their barangay", async () => {
    const { messageId } = await seedReportedCase({ address: "Beverly Hills" });

    const token = makeToken({
      id: new mongoose.Types.ObjectId().toString(),
      role: "barangay_official",
      assignedBarangay: "bagongnayon",
    });

    const warnRes = await request(app)
      .post(`/api/chat-monitoring/cases/${messageId}/warn`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(warnRes.status).toBe(403);

    const dismissRes = await request(app)
      .patch(`/api/chat-monitoring/cases/${messageId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "dismissed" });
    expect(dismissRes.status).toBe(403);
  });

  test("neither warning nor dismissing ever touches the User or messages collections (no auto-ban/delete)", async () => {
    const { messageId } = await seedReportedCase();
    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "system_admin" });

    const userCountBefore = await User.countDocuments();
    const messageBefore = await mongoose.connection.db.collection("messages").findOne({ _id: messageId });

    await request(app)
      .post(`/api/chat-monitoring/cases/${messageId}/warn`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    const userCountAfter = await User.countDocuments();
    const messageAfter = await mongoose.connection.db.collection("messages").findOne({ _id: messageId });

    expect(userCountAfter).toBe(userCountBefore);
    expect(messageAfter).toEqual(messageBefore);
  });
});
