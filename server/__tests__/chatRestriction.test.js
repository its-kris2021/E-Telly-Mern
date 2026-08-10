import request from "supertest";
import mongoose from "mongoose";
import { startTestDb, stopTestDb, clearTestDb } from "./helpers/testDb.js";
import { buildTestApp } from "./helpers/testApp.js";
import { makeToken } from "./helpers/auth.js";
import User from "../models/user.js";
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

async function reportAndWarn({ sender, reviewerToken, reason = "spam" }) {
  const reporter = await seedUser();
  const messageId = await seedMessage({ senderId: sender._id, receiverId: reporter._id });
  await request(app)
    .post("/api/message-reports")
    .set("Authorization", `Bearer ${makeToken({ id: reporter._id.toString(), role: "user" })}`)
    .send({ messageId: messageId.toString(), reason });
  return request(app)
    .post(`/api/chat-monitoring/cases/${messageId}/warn`)
    .set("Authorization", `Bearer ${reviewerToken}`)
    .send({});
}

function statusFor(userId) {
  return request(app)
    .get("/api/chat-restriction/status")
    .set("Authorization", `Bearer ${makeToken({ id: userId.toString(), role: "user" })}`);
}

describe("Chat restriction escalation ladder (via repeated confirmed violations)", () => {
  test("1st violation: warning only, no restriction", async () => {
    const sender = await seedUser({ address: "Bagong Nayon" });
    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "cdrrmo" });

    const res = await reportAndWarn({ sender, reviewerToken: token });
    expect(res.body.reportedUser.restricted).toBe(false);
    expect(res.body.reportedUser.restrictionType).toBe("none");

    const status = await statusFor(sender._id);
    expect(status.body.restricted).toBe(false);
    expect(status.body.message).toBeNull();
  });

  test("2nd violation: 24-hour temporary restriction", async () => {
    const sender = await seedUser({ address: "Bagong Nayon" });
    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "cdrrmo" });

    await reportAndWarn({ sender, reviewerToken: token });
    const res = await reportAndWarn({ sender, reviewerToken: token });

    expect(res.body.reportedUser.restricted).toBe(true);
    expect(res.body.reportedUser.restrictionType).toBe("temporary");
    const endAt = new Date(res.body.reportedUser.restrictionEndAt);
    const expectedEnd = Date.now() + 24 * 60 * 60 * 1000;
    expect(Math.abs(endAt.getTime() - expectedEnd)).toBeLessThan(5000);
  });

  test("3rd violation: 3-day temporary restriction", async () => {
    const sender = await seedUser({ address: "Bagong Nayon" });
    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "cdrrmo" });

    await reportAndWarn({ sender, reviewerToken: token });
    await reportAndWarn({ sender, reviewerToken: token });
    const res = await reportAndWarn({ sender, reviewerToken: token });

    expect(res.body.reportedUser.restrictionType).toBe("temporary");
    const endAt = new Date(res.body.reportedUser.restrictionEndAt);
    const expectedEnd = Date.now() + 3 * 24 * 60 * 60 * 1000;
    expect(Math.abs(endAt.getTime() - expectedEnd)).toBeLessThan(5000);
  });

  test("4th violation: 7-day temporary restriction", async () => {
    const sender = await seedUser({ address: "Bagong Nayon" });
    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "cdrrmo" });

    await reportAndWarn({ sender, reviewerToken: token });
    await reportAndWarn({ sender, reviewerToken: token });
    await reportAndWarn({ sender, reviewerToken: token });
    const res = await reportAndWarn({ sender, reviewerToken: token });

    expect(res.body.reportedUser.restrictionType).toBe("temporary");
    const endAt = new Date(res.body.reportedUser.restrictionEndAt);
    const expectedEnd = Date.now() + 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(endAt.getTime() - expectedEnd)).toBeLessThan(5000);
  });

  test("5th+ violations keep repeating the 7-day tier automatically (permanent stays admin-only)", async () => {
    const sender = await seedUser({ address: "Bagong Nayon" });
    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "cdrrmo" });

    for (let i = 0; i < 4; i++) await reportAndWarn({ sender, reviewerToken: token });
    const res = await reportAndWarn({ sender, reviewerToken: token });

    expect(res.body.reportedUser.restrictionType).toBe("temporary");
    expect(res.body.reportedUser.permanent).toBe(false);
    const endAt = new Date(res.body.reportedUser.restrictionEndAt);
    const expectedEnd = Date.now() + 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(endAt.getTime() - expectedEnd)).toBeLessThan(5000);
  });
});

describe("GET /api/chat-restriction/status — resident self-check", () => {
  test("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/chat-restriction/status");
    expect(res.status).toBe(401);
  });

  test("a never-violated user is not restricted", async () => {
    const user = await seedUser();
    const res = await statusFor(user._id);
    expect(res.status).toBe(200);
    expect(res.body.restricted).toBe(false);
    expect(res.body.message).toBeNull();
  });

  test("temporary restriction message matches the required exact copy and includes the expiry date/time", async () => {
    const user = await seedUser();
    const adminToken = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "system_admin" });

    await request(app)
      .post(`/api/chat-monitoring/users/${user._id}/restriction`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "temporary", durationHours: 24 });

    const res = await statusFor(user._id);
    expect(res.body.restricted).toBe(true);
    expect(res.body.message).toMatch(
      /^Your chat access is temporarily restricted due to repeated violations\. You can send messages again on .+\.$/,
    );
  });

  test("permanent restriction message matches the required exact copy", async () => {
    const user = await seedUser();
    const adminToken = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "system_admin" });

    await request(app)
      .post(`/api/chat-monitoring/users/${user._id}/restriction`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "permanent" });

    const res = await statusFor(user._id);
    expect(res.body.restricted).toBe(true);
    expect(res.body.permanent).toBe(true);
    expect(res.body.message).toBe(
      "Your chat access has been permanently restricted due to repeated or severe violations. Please contact an administrator if you believe this was a mistake.",
    );
  });

  test("a temporary restriction whose end time has already passed auto-expires on the next status check", async () => {
    const user = await seedUser();
    await ChatUserModerationProfile.create({
      userId: user._id,
      warningCount: 2,
      restricted: true,
      restrictedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      restrictionType: "temporary",
      restrictionStartAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      restrictionEndAt: new Date(Date.now() - 1000),
    });

    const res = await statusFor(user._id);
    expect(res.body.restricted).toBe(false);
    expect(res.body.message).toBeNull();

    const profile = await ChatUserModerationProfile.findOne({ userId: user._id });
    expect(profile.restricted).toBe(false);
    expect(profile.restrictionType).toBe("none");
    expect(profile.history.at(-1).action).toBe("restriction_expired");
  });

  test("a permanent restriction never auto-expires", async () => {
    const user = await seedUser();
    await ChatUserModerationProfile.create({
      userId: user._id,
      warningCount: 5,
      restricted: true,
      restrictedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 365),
      restrictionType: "permanent",
      restrictionStartAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 365),
      restrictionEndAt: null,
    });

    const res = await statusFor(user._id);
    expect(res.body.restricted).toBe(true);
    expect(res.body.permanent).toBe(true);
  });
});

describe("Admin manual restriction endpoints", () => {
  test("role 'user' cannot apply or clear a restriction", async () => {
    const target = await seedUser();
    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "user" });

    const apply = await request(app)
      .post(`/api/chat-monitoring/users/${target._id}/restriction`)
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "permanent" });
    expect(apply.status).toBe(403);

    const clear = await request(app)
      .delete(`/api/chat-monitoring/users/${target._id}/restriction`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(clear.status).toBe(403);
  });

  test("rejects a temporary restriction with no/invalid durationHours", async () => {
    const target = await seedUser();
    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "system_admin" });

    const res = await request(app)
      .post(`/api/chat-monitoring/users/${target._id}/restriction`)
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "temporary" });
    expect(res.status).toBe(400);
  });

  test("a barangay_official cannot restrict a user outside their assigned barangay", async () => {
    const target = await seedUser({ address: "Beverly Hills" });
    const token = makeToken({
      id: new mongoose.Types.ObjectId().toString(),
      role: "barangay_official",
      assignedBarangay: "bagongnayon",
    });

    const res = await request(app)
      .post(`/api/chat-monitoring/users/${target._id}/restriction`)
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "permanent" });
    expect(res.status).toBe(403);
  });

  test("system_admin can apply then clear a restriction, and clearing restores chat access", async () => {
    const target = await seedUser();
    const token = makeToken({ id: new mongoose.Types.ObjectId().toString(), role: "system_admin" });

    await request(app)
      .post(`/api/chat-monitoring/users/${target._id}/restriction`)
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "permanent", note: "Severe harassment across multiple reports." });

    let status = await statusFor(target._id);
    expect(status.body.restricted).toBe(true);
    expect(status.body.permanent).toBe(true);

    const clearRes = await request(app)
      .delete(`/api/chat-monitoring/users/${target._id}/restriction`)
      .set("Authorization", `Bearer ${token}`)
      .send({ note: "Appeal accepted." });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.moderation.restricted).toBe(false);

    status = await statusFor(target._id);
    expect(status.body.restricted).toBe(false);

    const profile = await ChatUserModerationProfile.findOne({ userId: target._id });
    expect(profile.history.map((h) => h.action)).toEqual(["restriction_applied", "restriction_removed"]);
  });
});
