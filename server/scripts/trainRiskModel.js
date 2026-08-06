/**
 * scripts/trainRiskModel.js
 *
 * Trains (or retrains) the flood and landslide risk models from real
 * accumulated report + weather data (scripts/buildTrainingSet.js), and
 * writes a new versioned server/models/RiskModel.js document for each.
 *
 * This is the concrete mechanism by which the system "learns from the data
 * and gets more accurate over time": every run refits the logistic
 * regression weights (services/logisticRegression.js) against whatever
 * reports have accumulated since the last run, starting from the same
 * informed prior each time (not from scratch, and not from the previous
 * run's weights — see defaultPriorWeights) so results stay reproducible and
 * auditable across versions.
 *
 * Runnable manually (`node scripts/trainRiskModel.js`) and wired into
 * scripts/alertEngine.js as a weekly cron via the exported trainRiskModels().
 * That export deliberately does NOT touch the mongoose connection or call
 * process.exit() — it assumes a connection already exists (true inside the
 * long-running server) — only the standalone CLI path at the bottom of this
 * file owns connect/disconnect/exit, since doing either inside a function
 * scheduled in the same process as the rest of the API would tear down the
 * shared connection / kill the server on every retrain.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";
import RiskModel from "../models/RiskModel.js";
import Alert from "../models/Alert.js";
import { buildTrainingSet } from "./buildTrainingSet.js";
import {
  fitStandardization,
  applyStandardization,
  trainLogisticRegression,
  kFoldCrossValidate,
  defaultPriorWeights,
} from "../services/logisticRegression.js";
import { FEATURE_NAMES } from "../services/riskFeatures.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const MIN_ROWS_TO_TRAIN = 5; // below this, standardization/CV aren't meaningful

// Live, post-hoc field performance — how past AI predictions for this hazard
// type actually did, per admin confirm/reject (routes/alerts.js) and the
// automatic weak-label paths (routes/reports.js linked-report auto-confirm,
// alertEngine.js expired-unconfirmed auto-reject). Distinct from the offline
// cross-validation `metrics` above: this is real-world outcomes, not a
// held-out split of historical data.
async function computeFieldMetrics(hazardType) {
  const [truePositives, falsePositives] = await Promise.all([
    Alert.countDocuments({ source: "ai", type: hazardType, confirmedOutcome: "true_positive" }),
    Alert.countDocuments({ source: "ai", type: hazardType, confirmedOutcome: "false_positive" }),
  ]);
  const total = truePositives + falsePositives;
  return {
    truePositives,
    falsePositives,
    precision: total > 0 ? truePositives / total : null,
  };
}

async function trainOne(hazardType) {
  console.log(`\n── ${hazardType} ──────────────────────────────`);
  const { rows } = await buildTrainingSet(hazardType);

  if (rows.length < MIN_ROWS_TO_TRAIN) {
    console.log(
      `Only ${rows.length} labeled barangay-day(s) available (need ${MIN_ROWS_TO_TRAIN}+). ` +
      `Skipping — the rule engine (services/${hazardType === "flood" ? "floodAlerts" : "landslideAlerts"}.js) ` +
      `keeps running unaffected; predictionEngine.js will simply have no AI model to load yet.`,
    );
    return;
  }

  const X = rows.map((r) => r.features);
  const y = rows.map((r) => r.label);
  const positiveCount = y.filter((v) => v === 1).length;

  const { means, stds } = fitStandardization(X);
  const Xstd = X.map((row) => applyStandardization(row, means, stds));
  const initialWeights = defaultPriorWeights(FEATURE_NAMES);

  const trainOpts = { initialWeights, initialBias: 0, l2: 0.5, lr: 0.1, epochs: 400 };

  // Cross-validated metrics estimate model quality on held-out folds.
  const metrics = kFoldCrossValidate(Xstd, y, { k: 5, ...trainOpts });

  // Final weights, fit on the full dataset, are what gets deployed.
  const { weights, bias } = trainLogisticRegression(Xstd, y, trainOpts);

  const lastVersionDoc = await RiskModel.findOne({ hazardType }).sort({ version: -1 });
  const version = (lastVersionDoc?.version ?? 0) + 1;

  await RiskModel.updateMany({ hazardType, isActive: true }, { $set: { isActive: false } });

  const notes =
    positiveCount < 5
      ? `Only ${positiveCount} positive example(s) — treat as a lightly-calibrated prior, not a confident model yet.`
      : "";

  const fieldMetrics = await computeFieldMetrics(hazardType);

  const doc = await RiskModel.create({
    hazardType,
    version,
    featureNames: FEATURE_NAMES,
    weights,
    bias,
    featureMeans: means,
    featureStds: stds,
    trainingSetSize: rows.length,
    positiveCount,
    metrics: {
      precision: metrics.precision,
      recall: metrics.recall,
      f1: metrics.f1,
      auc: metrics.auc,
    },
    fieldMetrics,
    isActive: true,
    notes,
  });

  console.log(
    `Trained v${version} — rows=${rows.length} positives=${positiveCount} ` +
    `precision=${fmt(metrics.precision)} recall=${fmt(metrics.recall)} f1=${fmt(metrics.f1)} auc=${fmt(metrics.auc)}`,
  );
  console.log(
    `  Field performance so far: ${fieldMetrics.truePositives} confirmed / ${fieldMetrics.falsePositives} false positive ` +
    `(precision=${fmt(fieldMetrics.precision)})`,
  );
  if (notes) console.log(`  Note: ${notes}`);
  return doc;
}

function fmt(v) {
  return v == null ? "n/a" : v.toFixed(2);
}

// The reusable core — called by the CLI path below and by alertEngine.js's
// weekly cron. Assumes mongoose is already connected.
export async function trainRiskModels() {
  console.log("[TrainRiskModel] Starting training run...");
  await trainOne("flood");
  await trainOne("landslide");
  console.log("[TrainRiskModel] Training run complete.");
}

// Standalone CLI usage only (`node scripts/trainRiskModel.js`) — owns the
// connection lifecycle here, unlike trainRiskModels() above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mongoose
    .connect(process.env.MONGO_URI)
    .then(async () => {
      console.log("Connected to MongoDB...");
      await trainRiskModels();
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch((err) => {
      console.error("Training failed:", err);
      process.exit(1);
    });
}
