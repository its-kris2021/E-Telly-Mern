import fs from "fs";
import os from "os";
import path from "path";
import mongoose from "mongoose";
import { startTestDb, stopTestDb, clearTestDb } from "./helpers/testDb.js";
import RiskModel from "../models/RiskModel.js";
import Alert from "../models/Alert.js";
import { checkOne, fmtPct } from "../scripts/checkFieldMetrics.js";

// All of this runs against an isolated in-memory MongoDB (mongodb-memory-server,
// see helpers/testDb.js) — never the real MONGO_URI. No production data is read
// or touched by this file.

beforeAll(async () => {
  await startTestDb();
}, 60000);

afterAll(async () => {
  await stopTestDb();
});

afterEach(async () => {
  await clearTestDb();
});

function makeAiAlert(overrides = {}) {
  return {
    source: "ai",
    type: "flood",
    severity: "watch",
    title: "AI-Predicted Flood Risk — Barangay Test",
    description: "test alert",
    confirmedOutcome: "unconfirmed",
    ...overrides,
  };
}

describe("fmtPct", () => {
  test("null/undefined -> N/A, not 0%", () => {
    expect(fmtPct(null)).toBe("N/A");
    expect(fmtPct(undefined)).toBe("N/A");
  });
  test("formats a real fraction as a percentage", () => {
    expect(fmtPct(0)).toBe("0.0%");
    expect(fmtPct(1)).toBe("100.0%");
    expect(fmtPct(0.25)).toBe("25.0%");
  });
});

describe("checkOne — no active model", () => {
  test("reports no_active_model and zero reviewed counts, not zero errors", async () => {
    const r = await checkOne("flood");
    expect(r.activeVersion).toBeNull();
    expect(r.boundaryStatus).toBe("no_active_model");
    expect(r.tpActive).toBe(0);
    expect(r.fpActive).toBe(0);
    expect(r.totalActive).toBe(0);
    expect(r.precisionActive).toBeNull(); // not 0 — "no data" must not look like "0% precision"
  });
});

describe("checkOne — exactly one active model", () => {
  test("no tagged alerts at all -> no_tagged_alerts, distinct from zero-reviewed", async () => {
    await RiskModel.create({
      hazardType: "flood",
      version: 13,
      operatingThreshold: 0.9246231155778895,
      isActive: true,
      trainedAt: new Date("2026-10-20T06:00:00Z"),
    });

    const r = await checkOne("flood");
    expect(r.activeVersion).toBe(13);
    expect(r.boundaryStatus).toBe("no_tagged_alerts");
    expect(r.totalActive).toBe(0);
    expect(r.precisionActive).toBeNull();
  });

  test("mixed confirmedOutcome values — only true_positive/false_positive count", async () => {
    const trainedAt = new Date("2026-10-20T06:00:00Z");
    await RiskModel.create({
      hazardType: "flood",
      version: 13,
      operatingThreshold: 0.9246231155778895,
      isActive: true,
      trainedAt,
    });

    const after = new Date(trainedAt.getTime() + 60 * 60 * 1000); // 1h after trainedAt
    await Alert.create(makeAiAlert({ modelVersion: "flood-v13", confirmedOutcome: "true_positive", createdAt: after }));
    await Alert.create(makeAiAlert({ modelVersion: "flood-v13", confirmedOutcome: "true_positive", createdAt: after }));
    await Alert.create(makeAiAlert({ modelVersion: "flood-v13", confirmedOutcome: "false_positive", createdAt: after }));
    await Alert.create(makeAiAlert({ modelVersion: "flood-v13", confirmedOutcome: "unconfirmed", createdAt: after }));
    await Alert.create(makeAiAlert({ modelVersion: "flood-v13", confirmedOutcome: "expired_unconfirmed", createdAt: after }));

    const r = await checkOne("flood");
    expect(r.tpActive).toBe(2);
    expect(r.fpActive).toBe(1);
    expect(r.totalActive).toBe(3); // unconfirmed + expired_unconfirmed excluded, not counted as FP
    expect(r.precisionActive).toBeCloseTo(2 / 3);
  });

  test("boundary status: confirmed when earliest tagged alert is on/after trainedAt", async () => {
    const trainedAt = new Date("2026-10-20T06:00:00Z");
    await RiskModel.create({
      hazardType: "landslide",
      version: 11,
      operatingThreshold: 0.9195979899497487,
      isActive: true,
      trainedAt,
    });
    const after = new Date(trainedAt.getTime() + 60 * 60 * 1000);
    await Alert.create(makeAiAlert({
      type: "landslide", modelVersion: "landslide-v11", confirmedOutcome: "unconfirmed", createdAt: after,
    }));

    const r = await checkOne("landslide");
    expect(r.boundaryStatus).toBe("confirmed");
  });

  test("boundary status: violated when a tagged alert predates trainedAt (the discovered overwrite risk)", async () => {
    const trainedAt = new Date("2026-10-20T06:00:00Z");
    await RiskModel.create({
      hazardType: "landslide",
      version: 11,
      operatingThreshold: 0.9195979899497487,
      isActive: true,
      trainedAt,
    });
    const before = new Date(trainedAt.getTime() - 60 * 60 * 1000); // simulates a stale
    // alert whose modelVersion was overwritten onto the current version by a
    // later same-day re-scoring cycle, per services/alertHelpers.js upsertAlert.
    await Alert.create(makeAiAlert({
      type: "landslide", modelVersion: "landslide-v11", confirmedOutcome: "unconfirmed", createdAt: before,
    }));

    const r = await checkOne("landslide");
    expect(r.boundaryStatus).toBe("violated");
  });

  test("historical breakdown groups reviewed outcomes by modelVersion, separate from the active-version figure", async () => {
    const trainedAt = new Date("2026-10-20T06:00:00Z");
    await RiskModel.create({
      hazardType: "flood", version: 13, operatingThreshold: 0.9246231155778895, isActive: true, trainedAt,
    });
    const after = new Date(trainedAt.getTime() + 60 * 60 * 1000);
    await Alert.create(makeAiAlert({ modelVersion: "flood-v13", confirmedOutcome: "true_positive", createdAt: after }));
    await Alert.create(makeAiAlert({ modelVersion: "flood-v11", confirmedOutcome: "false_positive", createdAt: after }));

    const r = await checkOne("flood");
    expect(r.tpActive).toBe(1); // only v13's own reviewed outcomes
    expect(r.fpActive).toBe(0);
    expect(r.byVersion.get("flood-v13")).toEqual({ tp: 1, fp: 0 });
    expect(r.byVersion.get("flood-v11")).toEqual({ tp: 0, fp: 1 }); // historical, not pooled into active figure
  });
});

describe("checkOne — multiple active models for the same hazardType", () => {
  test("throws a clear error instead of arbitrarily picking one", async () => {
    await RiskModel.create({ hazardType: "flood", version: 12, isActive: true, trainedAt: new Date() });
    await RiskModel.create({ hazardType: "flood", version: 13, isActive: true, trainedAt: new Date() });

    await expect(checkOne("flood")).rejects.toThrow(/Multiple active RiskModel documents/);
  });

  test("landslide is unaffected by flood having multiple active models (checked independently)", async () => {
    await RiskModel.create({ hazardType: "flood", version: 12, isActive: true, trainedAt: new Date() });
    await RiskModel.create({ hazardType: "flood", version: 13, isActive: true, trainedAt: new Date() });
    await RiskModel.create({ hazardType: "landslide", version: 11, isActive: true, trainedAt: new Date() });

    const r = await checkOne("landslide");
    expect(r.activeVersion).toBe(11);
    await expect(checkOne("flood")).rejects.toThrow(/Multiple active RiskModel documents/);
  });
});

// Filesystem-only — does not touch MongoDB at all. Exercises the exact
// mechanism scripts/checkFieldMetrics.js uses to refuse overwriting an
// existing report ({ flag: "wx" }), in isolation from main()'s process.exit
// calls (which would otherwise kill the Jest worker if main() were invoked
// directly).
describe("exclusive report-file creation", () => {
  test("{ flag: 'wx' } throws EEXIST instead of overwriting an existing file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-field-metrics-test-"));
    const file = path.join(dir, "field-metrics-2026-10-20.md");
    fs.writeFileSync(file, "original content");

    let threw = null;
    try {
      fs.writeFileSync(file, "new content", { flag: "wx" });
    } catch (err) {
      threw = err;
    }

    expect(threw).not.toBeNull();
    expect(threw.code).toBe("EEXIST");
    expect(fs.readFileSync(file, "utf8")).toBe("original content"); // untouched

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
