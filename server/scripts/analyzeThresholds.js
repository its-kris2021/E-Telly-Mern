/**
 * Read-only analysis: sweeps thresholds against pooled CV predictions for
 * both hazard types, using whatever feature set riskFeatures.js currently
 * defines (today: the shapefile-grounded susceptibility feature). Does NOT
 * write a RiskModel doc or touch isActive — purely to pick an informed
 * minRecall value for scripts/trainRiskModel.js before committing to it.
 *
 * Usage: node scripts/analyzeThresholds.js
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { buildTrainingSet, loadSharedTrainingData } from "./buildTrainingSet.js";
import {
  fitStandardization,
  applyStandardization,
  kFoldCrossValidate,
  defaultPriorWeights,
  computeMetrics,
} from "../services/logisticRegression.js";
import { FEATURE_NAMES } from "../services/riskFeatures.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

async function analyzeOne(hazardType, sharedData) {
  const { rows } = await buildTrainingSet(hazardType, sharedData);
  const X = rows.map((r) => r.features);
  const y = rows.map((r) => r.label);

  const { means, stds } = fitStandardization(X);
  const Xstd = X.map((row) => applyStandardization(row, means, stds));
  const initialWeights = defaultPriorWeights(FEATURE_NAMES);
  const trainOpts = { initialWeights, initialBias: 0, l2: 0.5, lr: 0.1, epochs: 400 };

  const { pooledTrue, pooledProb } = await kFoldCrossValidate(Xstd, y, { k: 5, ...trainOpts });

  console.log(`\n== ${hazardType} (rows=${rows.length}, positives=${y.filter(v=>v===1).length}) ==`);
  console.log("thr    precision  recall   f1      tp   fp   fn   nPredictedPositive");
  const thresholds = [0.50,0.70,0.80,0.85,0.88,0.90,0.915,0.925,0.93,0.94,0.95,0.96,0.97,0.98,0.99];
  for (const thr of thresholds) {
    const m = computeMetrics(pooledTrue, pooledProb, thr);
    const nPred = m.tp + m.fp;
    console.log(
      `${thr.toFixed(3)}  ${fmt(m.precision)}     ${fmt(m.recall)}   ${fmt(m.f1)}   ${m.tp}    ${m.fp}   ${m.fn}   ${nPred}`
    );
  }
}

function fmt(v) {
  return v == null ? " n/a" : v.toFixed(3);
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB...");
  const sharedData = await loadSharedTrainingData();
  await analyzeOne("flood", sharedData);
  await analyzeOne("landslide", sharedData);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
