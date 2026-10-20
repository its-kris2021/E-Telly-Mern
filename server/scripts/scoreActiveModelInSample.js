// scripts/scoreActiveModelInSample.js
//
// READ-ONLY. Loads the currently active flood/landslide RiskModel documents
// and scores them, using the EXACT production preprocessing and inference
// functions (applyStandardization + predictProba from services/logisticRegression.js),
// against the full historical HazardSnapshot/report dataset.
//
// IMPORTANT: This is an IN-SAMPLE check, not a holdout evaluation. trainRiskModel.js
// fits final weights on 100% of historical rows (see its trainOne()) — there is no
// historical period these models haven't already seen. This script exists only to
// verify the deployed weights/threshold reproduce their training-time numbers via the
// real production code path end-to-end; it must NOT be read as a generalization
// estimate, and must NOT be used alone to justify keeping or rolling back a model.
// See scripts/output/evaluation-2026-10-19.md for the most recent honest (but
// differently-trained) date-holdout numbers, which remain the best available proxy
// for "how would this approach do on unseen data."
//
// Makes NO writes to MongoDB. Writes one local report file under scripts/output/.
// Usage: node scripts/scoreActiveModelInSample.js [flood|landslide|both]

import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import RiskModel from "../models/RiskModel.js";
import { loadSharedTrainingData, buildTrainingSet } from "./buildTrainingSet.js";
import { FEATURE_NAMES } from "../services/riskFeatures.js";
import { applyStandardization, predictProba, computeMetrics } from "../services/logisticRegression.js";

const EXPECTED = {
  flood:     { version: 13, operatingThreshold: 0.9246231155778895 },
  landslide: { version: 11, operatingThreshold: 0.9195979899497487 },
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

function arraysEqual(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
}

async function scoreOne(hazardType, sharedData) {
  const model = await RiskModel.findOne({ hazardType, isActive: true }).lean();
  if (!model) throw new Error(`No active RiskModel found for ${hazardType}`);

  const expected = EXPECTED[hazardType];
  console.log(`\n${hazardType.toUpperCase()} — loaded active model: version=${model.version}, ` +
    `operatingThreshold=${model.operatingThreshold}, trainedAt=${model.trainedAt?.toISOString()}, ` +
    `trainingSetSize=${model.trainingSetSize}`);

  if (model.version !== expected.version) {
    throw new Error(
      `Loaded version (${model.version}) does not match expected (${expected.version}) for ${hazardType} — ` +
      `active model may have changed since this evaluation was requested. Aborting without scoring.`,
    );
  }
  if (Math.abs(model.operatingThreshold - expected.operatingThreshold) > 1e-9) {
    throw new Error(
      `Loaded operatingThreshold (${model.operatingThreshold}) does not match expected ` +
      `(${expected.operatingThreshold}) for ${hazardType}. Aborting without scoring.`,
    );
  }
  if (!arraysEqual(model.featureNames, FEATURE_NAMES)) {
    throw new Error(
      `Stored featureNames order does not match current riskFeatures.js FEATURE_NAMES for ${hazardType} — ` +
      `scoring would silently misalign features. Aborting.`,
    );
  }
  if (!Array.isArray(model.weights) || model.weights.length !== FEATURE_NAMES.length) {
    throw new Error(
      `Stored weights length (${model.weights?.length}) does not match FEATURE_NAMES length ` +
      `(${FEATURE_NAMES.length}) for ${hazardType}. Aborting.`,
    );
  }
  if (!Array.isArray(model.featureMeans) || model.featureMeans.length !== FEATURE_NAMES.length ||
      !Array.isArray(model.featureStds) || model.featureStds.length !== FEATURE_NAMES.length) {
    throw new Error(`Stored featureMeans/featureStds dimension mismatch for ${hazardType}. Aborting.`);
  }

  const { rows } = await buildTrainingSet(hazardType, sharedData);
  for (const r of rows) {
    if (r.features.length !== FEATURE_NAMES.length) {
      throw new Error(
        `Row for barangay=${r.barangay} day=${r.day} has ${r.features.length} features, ` +
        `expected ${FEATURE_NAMES.length}. Aborting.`,
      );
    }
  }

  const y = rows.map((r) => r.label);
  const probs = rows.map((r) => {
    const standardized = applyStandardization(r.features, model.featureMeans, model.featureStds);
    return predictProba(standardized, model.weights, model.bias);
  });

  const metrics = computeMetrics(y, probs, model.operatingThreshold);
  const totalPositives = y.reduce((s, v) => s + v, 0);
  const sortedDays = [...new Set(rows.map((r) => r.day))].sort();

  return {
    hazardType, version: model.version, operatingThreshold: model.operatingThreshold,
    trainedAt: model.trainedAt, rowCount: rows.length, dayCount: sortedDays.length,
    dateRange: [sortedDays[0], sortedDays[sortedDays.length - 1]],
    totalPositives, metrics,
  };
}

async function main() {
  const arg = (process.argv[2] ?? "both").toLowerCase();
  const hazards = arg === "both" ? ["flood", "landslide"] : [arg];
  if (!hazards.every((h) => h === "flood" || h === "landslide")) {
    console.error("Usage: node scripts/scoreActiveModelInSample.js [flood|landslide|both]");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB (read-only — no writes to models/data will be made).");
  console.log("\n*** THIS IS AN IN-SAMPLE CHECK, NOT A HOLDOUT EVALUATION — see file header. ***");
  console.log("*** Do not use these numbers alone to justify keeping or rolling back a model. ***");

  const sharedData = await loadSharedTrainingData();
  const results = {};
  try {
    for (const h of hazards) {
      results[h] = await scoreOne(h, sharedData);
      const r = results[h];
      console.log(
        `\n${h}: v${r.version} scored in-sample over ${r.rowCount} rows / ${r.dayCount} days ` +
        `(${r.dateRange[0]} .. ${r.dateRange[1]}), ${r.totalPositives} positives.\n` +
        `  @ threshold=${r.operatingThreshold}: precision=${r.metrics.precision?.toFixed(3)} ` +
        `recall=${r.metrics.recall?.toFixed(3)} f1=${r.metrics.f1?.toFixed(3)} auc=${r.metrics.auc?.toFixed(3)}\n` +
        `  Confusion: TP=${r.metrics.tp} FP=${r.metrics.fp} FN=${r.metrics.fn} TN=${r.metrics.tn}`,
      );
    }
  } finally {
    // Nothing to roll back — no writes were made — but keep the connection
    // teardown in a finally so a thrown safety check still disconnects cleanly.
    await mongoose.disconnect();
  }

  const outDir = path.join(__dirname, "output");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `in-sample-check-${new Date().toISOString().slice(0, 10)}.md`);
  let md = `# Active-model in-sample check — ${new Date().toISOString().slice(0, 10)}\n\n`;
  md += `**This is NOT a holdout/generalization evaluation.** The active models were fit on 100% of ` +
    `historical rows (see scripts/trainRiskModel.js), so no historical period is unseen by them. This ` +
    `report only confirms the deployed weights/threshold behave as expected via the real production ` +
    `inference path. Do not use these numbers alone to justify keeping or rolling back a model. For the ` +
    `best available (differently-trained) honest date-holdout estimate, see ` +
    `scripts/output/evaluation-2026-10-19.md.\n\n`;
  for (const h of hazards) {
    const r = results[h];
    md += `## ${h} (v${r.version})\n\n` +
      `- Data scored: ${r.rowCount} rows / ${r.dayCount} days, ${r.dateRange[0]} to ${r.dateRange[1]}\n` +
      `- Positives: ${r.totalPositives}\n` +
      `- Threshold: ${r.operatingThreshold}\n` +
      `- Precision: ${r.metrics.precision} | Recall: ${r.metrics.recall} | F1: ${r.metrics.f1} | AUC: ${r.metrics.auc}\n` +
      `- Confusion: TP=${r.metrics.tp} FP=${r.metrics.fp} FN=${r.metrics.fn} TN=${r.metrics.tn}\n\n`;
  }
  fs.writeFileSync(outPath, md);
  console.log(`\nWrote: ${outPath}`);
}

main().catch((err) => {
  console.error("Check failed:", err.message);
  process.exit(1);
});
