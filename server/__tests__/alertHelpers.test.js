import mongoose from "mongoose";
import { startTestDb, stopTestDb, clearTestDb } from "./helpers/testDb.js";
import Alert from "../models/Alert.js";
import { upsertAiAlert, upsertSystemAlert } from "../services/alertHelpers.js";

// All of this runs against an isolated in-memory MongoDB (mongodb-memory-server,
// see helpers/testDb.js) — never the real MONGO_URI. No production data is read
// or touched by this file. sendAdminNotification/sendFCMToBarangays are
// fire-and-forget (not awaited) in the code under test and no-op safely with
// no configured push/FCM credentials in this environment — not mocked here,
// matching how the production code already tolerates their absence.

beforeAll(async () => {
  await startTestDb();
}, 60000);

afterAll(async () => {
  await stopTestDb();
});

afterEach(async () => {
  await clearTestDb();
});

const DEDUPE_KEY = "ai_flood_bagongnayon_2026-10-20";

function makeAiAlertData(overrides = {}) {
  return {
    _dedupeKey: DEDUPE_KEY,
    type: "flood",
    severity: "watch",
    title: "AI-Predicted Flood Risk — Barangay Bagong Nayon",
    description: "The risk model estimates an elevated chance of a flood report.",
    barangays: ["bagongnayon"],
    location: "14.6261,121.1687",
    lat: 14.6261,
    lng: 121.1687,
    confidence: 0.93,
    modelVersion: "flood-v13",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

describe("upsertAiAlert — model-version and review-state attribution", () => {
  test("1. a newly generated alert is saved with the correct model version and confidence", async () => {
    const isNew = await upsertAiAlert(makeAiAlertData());
    expect(isNew).toBe(true);

    const doc = await Alert.findOne({ _dedupeKey: DEDUPE_KEY });
    expect(doc).not.toBeNull();
    expect(doc.modelVersion).toBe("flood-v13");
    expect(doc.confidence).toBe(0.93);
    expect(doc.confirmedOutcome).toBe("unconfirmed");
    expect(doc.isActive).toBe(true);
    expect(doc.source).toBe("ai");
  });

  test("2. a repeated same-version prediction does not corrupt a reviewed alert's version, confidence, or outcome", async () => {
    await upsertAiAlert(makeAiAlertData({ confidence: 0.93 }));
    const original = await Alert.findOne({ _dedupeKey: DEDUPE_KEY });

    // Simulate an admin confirm — the exact fields routes/alerts.js's
    // PATCH /:id/confirm touches, nothing more.
    await Alert.findOneAndUpdate(
      { _id: original._id, source: "ai" },
      { confirmedOutcome: "true_positive", confirmedBy: "admin1", confirmedAt: new Date() },
    );

    // A later cycle re-scores the same barangay/hazard/day with the SAME
    // model version but a different probability reading.
    const isNewOnRescore = await upsertAiAlert(makeAiAlertData({ confidence: 0.97 }));
    expect(isNewOnRescore).toBe(true); // must NOT update the reviewed doc — creates a new one instead

    const docs = await Alert.find({ _dedupeKey: DEDUPE_KEY }).sort({ createdAt: 1 });
    expect(docs).toHaveLength(2);

    const reviewed = docs.find((d) => d.confirmedOutcome === "true_positive");
    expect(reviewed).toBeDefined();
    expect(reviewed.modelVersion).toBe("flood-v13"); // unchanged
    expect(reviewed.confidence).toBe(0.93); // unchanged — the reviewed record is frozen

    const fresh = docs.find((d) => d.confirmedOutcome === "unconfirmed");
    expect(fresh).toBeDefined();
    expect(fresh.confidence).toBe(0.97);
  });

  test("3. a later prediction from a different model version cannot silently relabel the existing alert", async () => {
    await upsertAiAlert(makeAiAlertData({ modelVersion: "flood-v13", confidence: 0.93 }));
    const isNewOnRetrain = await upsertAiAlert(makeAiAlertData({ modelVersion: "flood-v14", confidence: 0.95 }));
    expect(isNewOnRetrain).toBe(true);

    const docs = await Alert.find({ _dedupeKey: DEDUPE_KEY });
    expect(docs).toHaveLength(2);

    const v13doc = docs.find((d) => d.modelVersion === "flood-v13");
    const v14doc = docs.find((d) => d.modelVersion === "flood-v14");
    expect(v13doc).toBeDefined();
    expect(v14doc).toBeDefined();
    expect(v13doc.confidence).toBe(0.93); // untouched by the newer version's cycle
    expect(v14doc.confidence).toBe(0.95);
  });

  test("4. an unreviewed alert with the same model version follows the intended update policy (updates in place)", async () => {
    await upsertAiAlert(makeAiAlertData({ confidence: 0.90, severity: "watch" }));
    const isNewOnRefresh = await upsertAiAlert(makeAiAlertData({ confidence: 0.95, severity: "warning" }));
    expect(isNewOnRefresh).toBe(false); // legitimate refresh, not a new alert

    const docs = await Alert.find({ _dedupeKey: DEDUPE_KEY });
    expect(docs).toHaveLength(1);
    expect(docs[0].confidence).toBe(0.95);
    expect(docs[0].severity).toBe("warning");
  });

  test("6. repeated same-version unconfirmed prediction cycles do not create unintended duplicate alerts", async () => {
    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line no-await-in-loop
      await upsertAiAlert(makeAiAlertData({ confidence: 0.80 + i * 0.01 }));
    }
    const docs = await Alert.find({ _dedupeKey: DEDUPE_KEY });
    expect(docs).toHaveLength(1);
    expect(docs[0].confidence).toBeCloseTo(0.84);
  });
});

describe("upsertSystemAlert — unaffected by the AI-specific matchExtra change", () => {
  test("system alerts still upsert on {_dedupeKey, isActive} alone, with no matchExtra narrowing", async () => {
    const data = {
      _dedupeKey: "system_flood_bagongnayon_2026-10-20",
      type: "flood",
      severity: "evacuate",
      title: "Flood Evacuation — Barangay Bagong Nayon",
      description: "Rule-based flood evacuation alert.",
      barangays: ["bagongnayon"],
    };
    const isNew = await upsertSystemAlert(data);
    expect(isNew).toBe(true);

    // A second call with the same dedupeKey, still isActive — must update in
    // place exactly as before this change (upsertSystemAlert never passes
    // matchExtra, so behavior for source:"system" alerts is identical).
    const isNewAgain = await upsertSystemAlert({ ...data, severity: "critical" });
    expect(isNewAgain).toBe(false);

    const docs = await Alert.find({ _dedupeKey: "system_flood_bagongnayon_2026-10-20" });
    expect(docs).toHaveLength(1);
    expect(docs[0].severity).toBe("critical");
  });
});

describe("5. confirm/reject/expiry data-layer contract still holds", () => {
  // These mirror the exact field-level update patterns used by
  // routes/alerts.js (PATCH /:id/confirm, /:id/reject) and
  // scripts/alertEngine.js (runExpiryCleanup) — not a direct import of those
  // route handlers/cron function (which pull in auth/Express or aren't
  // exported), but the same underlying Mongo operations, to verify this
  // fix did not change what those operations are allowed to touch.

  test("confirm sets confirmedOutcome/confirmedBy/confirmedAt without touching modelVersion/confidence", async () => {
    await upsertAiAlert(makeAiAlertData());
    const before = await Alert.findOne({ _dedupeKey: DEDUPE_KEY });

    await Alert.findOneAndUpdate(
      { _id: before._id, source: "ai" },
      { confirmedOutcome: "true_positive", confirmedBy: "admin1", confirmedAt: new Date() },
      { new: true },
    );

    const after = await Alert.findById(before._id);
    expect(after.confirmedOutcome).toBe("true_positive");
    expect(after.modelVersion).toBe(before.modelVersion);
    expect(after.confidence).toBe(before.confidence);
  });

  test("reject sets confirmedOutcome=false_positive without touching modelVersion/confidence", async () => {
    await upsertAiAlert(makeAiAlertData());
    const before = await Alert.findOne({ _dedupeKey: DEDUPE_KEY });

    await Alert.findOneAndUpdate(
      { _id: before._id, source: "ai" },
      { confirmedOutcome: "false_positive", confirmedBy: "admin1", confirmedAt: new Date() },
      { new: true },
    );

    const after = await Alert.findById(before._id);
    expect(after.confirmedOutcome).toBe("false_positive");
    expect(after.modelVersion).toBe(before.modelVersion);
    expect(after.confidence).toBe(before.confidence);
  });

  test("expiry cleanup deactivates and marks unconfirmed-expired alerts without altering modelVersion", async () => {
    await upsertAiAlert(makeAiAlertData({ expiresAt: new Date(Date.now() - 1000) })); // already expired
    const before = await Alert.findOne({ _dedupeKey: DEDUPE_KEY });

    const expiring = await Alert.find(
      { isActive: true, expiresAt: { $lt: new Date() } },
      { _id: 1, source: 1, confirmedOutcome: 1 },
    ).lean();
    const ids = expiring.map((a) => a._id);
    await Alert.updateMany({ _id: { $in: ids } }, { $set: { isActive: false, updatedAt: new Date() } });

    const aiUnconfirmedIds = expiring
      .filter((a) => a.source === "ai" && a.confirmedOutcome === "unconfirmed")
      .map((a) => a._id);
    await Alert.updateMany(
      { _id: { $in: aiUnconfirmedIds } },
      { $set: { confirmedOutcome: "expired_unconfirmed", confirmedBy: "auto:expired_unconfirmed", confirmedAt: new Date() } },
    );

    const after = await Alert.findById(before._id);
    expect(after.isActive).toBe(false);
    expect(after.confirmedOutcome).toBe("expired_unconfirmed");
    expect(after.modelVersion).toBe(before.modelVersion);
    expect(after.confidence).toBe(before.confidence);
  });
});

// 7. Concurrency: Alert._dedupeKey (models/Alert.js) is indexed but NOT
// declared unique, and adding a unique index now would be wrong — this fix
// deliberately allows more than one document to share a _dedupeKey once one
// of them is reviewed or superseded by a different model version. That means
// nothing in the current schema/architecture prevents two truly concurrent
// upsertAiAlert() calls for the SAME brand-new key (no existing document,
// same version, both unconfirmed) from both seeing "no match" and both
// inserting — a genuine duplicate. This is a real, documented limitation of
// the existing non-unique-index architecture, not something this change
// introduces or claims to solve. A race like this is inherently
// timing-dependent and not something a deterministic Jest assertion can
// honestly prove either way, so it is documented here rather than asserted
// as passing. Closing this gap would require a MongoDB partial unique index
// on {_dedupeKey, isActive} filtered to confirmedOutcome:"unconfirmed" — a
// schema change outside the scope of this fix.
test.todo(
  "concurrent upsertAiAlert() calls for a brand-new _dedupeKey can race into duplicate documents " +
  "(no unique index on _dedupeKey) — documented limitation, not fixed here; see services/alertHelpers.js",
);
