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
 * scripts/alertEngine.js as a daily cron via the exported trainRiskModels().
 * That export deliberately does NOT touch the mongoose connection or call
 * process.exit() — it assumes a connection already exists (true inside the
 * long-running server) — only the standalone CLI path at the bottom of this
 * file owns connect/disconnect/exit, since doing either inside a function
 * scheduled in the same process as the rest of the API would tear down the
 * shared connection / kill the server on every retrain.
 *
 * Promotion safety (matters a lot more once this runs unattended daily than
 * it did when a human ran it by hand and could eyeball the output): a new
 * version is only ever activated if (a) training completed without throwing
 * and (b) isValidTrainedModel() passes basic sanity checks on the result.
 * The previous active version is never deactivated until the new one is
 * already confirmed active, so a crash, a bad training run, or a Mongo
 * hiccup mid-write can never leave predictionEngine.js with zero active
 * models for a hazard type — worst case, it keeps serving the last good
 * version, which is exactly the fallback behavior wanted here.
 *
 * Every invocation is also recorded in server/models/RetrainRun.js
 * (startedAt/finishedAt/status, plus a per-hazard summary). This exists
 * because the previous version of this job had no persisted record at all,
 * and an OOM SIGKILL (Heroku R14/R15 — see buildTrainingSet.js's
 * loadBarangayDaySnapshots header) silently ran every night for two weeks
 * before anyone noticed the model had stopped updating, with the only
 * evidence being Heroku's own ephemeral log buffer. A "running" RetrainRun
 * row with no matching completed/error row by the next check is now the
 * signal that a run was killed mid-flight — that kind of OS-level kill
 * can't be caught in application code, but its *absence of a result* can
 * be made visible.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";
import RiskModel from "../models/RiskModel.js";
import Alert from "../models/Alert.js";
import RetrainRun from "../models/RetrainRun.js";
import { buildTrainingSet, loadSharedTrainingData } from "./buildTrainingSet.js";
import {
  fitStandardization,
  applyStandardization,
  trainLogisticRegression,
  kFoldCrossValidate,
  defaultPriorWeights,
  findOptimalThreshold,
  computeMetrics,
} from "../services/logisticRegression.js";
import { FEATURE_NAMES } from "../services/riskFeatures.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const MIN_ROWS_TO_TRAIN = 5; // below this, standardization/CV aren't meaningful
// Operating threshold is chosen as the highest value that still catches at
// least this fraction of real positive cases on held-out CV folds (see
// services/logisticRegression.js findOptimalThreshold) — lower this to gate
// alerts more aggressively (more recall, more false positives), raise it
// for the opposite. Revisit using each model's stored fieldMetrics
// (real confirm/reject outcomes) once a few retrain cycles have accumulated.
const OPERATING_THRESHOLD_MIN_RECALL = 0.5;

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

// Sanity checks on a freshly trained model before it's allowed to replace
// the active one — this is the "metrics are valid" gate. Catches the
// concrete ways an automated retrain can go wrong unattended: gradient
// descent diverging to NaN/Infinity (e.g. from a bad learning rate or a
// pathological batch), a threshold search landing outside (0,1), or an AUC
// outside its valid [0,1] range. A human running this by hand would notice
// garbage output before it mattered; a daily unattended cron won't, so this
// is what stands in for that judgment call.
function isValidTrainedModel({ weights, bias, operatingThreshold, metrics }) {
  const finite = (v) => typeof v === "number" && Number.isFinite(v);
  if (!Array.isArray(weights) || weights.length !== FEATURE_NAMES.length) return false;
  if (!weights.every(finite)) return false;
  if (!finite(bias)) return false;
  if (!finite(operatingThreshold) || operatingThreshold <= 0 || operatingThreshold >= 1) return false;
  if (metrics.auc != null && (!finite(metrics.auc) || metrics.auc < 0 || metrics.auc > 1)) return false;
  return true;
}

async function trainOne(hazardType, sharedData) {
  console.log(`\n── ${hazardType} ──────────────────────────────`);
  const { rows } = await buildTrainingSet(hazardType, sharedData);

  if (rows.length < MIN_ROWS_TO_TRAIN) {
    console.log(
      `Only ${rows.length} labeled barangay-day(s) available (need ${MIN_ROWS_TO_TRAIN}+). ` +
      `Skipping — the rule engine (services/${hazardType === "flood" ? "floodAlerts" : "landslideAlerts"}.js) ` +
      `keeps running unaffected; predictionEngine.js will simply have no AI model to load yet.`,
    );
    return { status: "skipped_insufficient_data", rowCount: rows.length };
  }

  const X = rows.map((r) => r.features);
  const y = rows.map((r) => r.label);
  const positiveCount = y.filter((v) => v === 1).length;

  const { means, stds } = fitStandardization(X);
  const Xstd = X.map((row) => applyStandardization(row, means, stds));
  const initialWeights = defaultPriorWeights(FEATURE_NAMES);

  const trainOpts = { initialWeights, initialBias: 0, l2: 0.5, lr: 0.1, epochs: 400 };

  let metrics, pooledTrue, pooledProb, operatingThreshold, metricsAtOperatingThreshold, weights, bias;
  try {
    // Cross-validated metrics estimate model quality on held-out folds.
    ({ metrics, pooledTrue, pooledProb } = await kFoldCrossValidate(Xstd, y, { k: 5, ...trainOpts }));

    // Positives are a tiny fraction of rows (see logisticRegression.js
    // findOptimalThreshold) — the conventional 0.5 cutoff never fires, so pick
    // the threshold that actually separates positives from negatives in this
    // model's own held-out predictions, and report metrics at that point too.
    operatingThreshold = findOptimalThreshold(pooledTrue, pooledProb, {
      minRecall: OPERATING_THRESHOLD_MIN_RECALL,
    });
    metricsAtOperatingThreshold = computeMetrics(pooledTrue, pooledProb, operatingThreshold);

    // Final weights, fit on the full dataset, are what gets deployed.
    ({ weights, bias } = await trainLogisticRegression(Xstd, y, trainOpts));
  } catch (err) {
    console.error(`Training threw an error — keeping previous active model: ${err.message}`);
    return { status: "error", error: err.message, rowCount: rows.length };
  }

  if (!isValidTrainedModel({ weights, bias, operatingThreshold, metrics })) {
    console.log(
      "Training completed but produced invalid weights/threshold/metrics (NaN, Infinity, or out of " +
      "range) — discarding this run and keeping the previous active model as-is.",
    );
    return { status: "invalid", rowCount: rows.length };
  }

  const lastVersionDoc = await RiskModel.findOne({ hazardType }).sort({ version: -1 });
  const version = (lastVersionDoc?.version ?? 0) + 1;

  const notes =
    positiveCount < 5
      ? `Only ${positiveCount} positive example(s) — treat as a lightly-calibrated prior, not a confident model yet.`
      : "";

  const fieldMetrics = await computeFieldMetrics(hazardType);

  // Create the new version inactive first, then flip it active, and only
  // then deactivate the old one(s) — see the file header comment. If any
  // step here throws, the worst case is the old version stays (or briefly
  // both are) active; it is never the case that neither is.
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
    operatingThreshold,
    metricsAtOperatingThreshold: {
      precision: metricsAtOperatingThreshold.precision,
      recall: metricsAtOperatingThreshold.recall,
      f1: metricsAtOperatingThreshold.f1,
    },
    fieldMetrics,
    isActive: false,
    notes,
  });
  doc.isActive = true;
  await doc.save();
  await RiskModel.updateMany(
    { hazardType, isActive: true, _id: { $ne: doc._id } },
    { $set: { isActive: false } },
  );

  console.log(
    `Trained v${version} — rows=${rows.length} positives=${positiveCount} ` +
    `[@0.50] precision=${fmt(metrics.precision)} recall=${fmt(metrics.recall)} f1=${fmt(metrics.f1)} auc=${fmt(metrics.auc)}`,
  );
  console.log(
    `  [@${operatingThreshold.toFixed(3)} operating threshold] precision=${fmt(metricsAtOperatingThreshold.precision)} ` +
    `recall=${fmt(metricsAtOperatingThreshold.recall)} f1=${fmt(metricsAtOperatingThreshold.f1)}`,
  );
  console.log(
    `  Field performance so far: ${fieldMetrics.truePositives} confirmed / ${fieldMetrics.falsePositives} false positive ` +
    `(precision=${fmt(fieldMetrics.precision)})`,
  );
  if (notes) console.log(`  Note: ${notes}`);
  return { status: "promoted", version, rowCount: rows.length, doc };
}

function fmt(v) {
  return v == null ? "n/a" : v.toFixed(2);
}

// The reusable core — called by the CLI path below and by alertEngine.js's
// daily cron. Assumes mongoose is already connected. Returns a per-hazard
// status summary (not thrown errors) so a scheduled caller can log a clean
// one-line result without needing to know this module's internals.
export async function trainRiskModels() {
  // A "running" row still open after 2 hours means the process that owned
  // it never got to write a final status — almost certainly killed
  // mid-run (OOM SIGKILL) rather than still legitimately in progress, since
  // a full run normally finishes in well under a minute.
  await RetrainRun.updateMany(
    { status: "running", startedAt: { $lt: new Date(Date.now() - 2 * 60 * 60 * 1000) } },
    { $set: { status: "presumed_crashed", finishedAt: new Date() } },
  );

  const run = await RetrainRun.create({ status: "running" });
  console.log(`[TrainRiskModel] Starting training run... (RetrainRun ${run._id})`);

  let flood, landslide;
  try {
    // Loaded once and reused for both hazard types — flood/landslide need
    // the exact same snapshots/reports, only the label computation differs
    // (see buildTrainingSet.js). Halves peak memory and DB load per run.
    const sharedData = await loadSharedTrainingData();
    flood = await trainOne("flood", sharedData);
    landslide = await trainOne("landslide", sharedData);
  } catch (err) {
    // trainOne() already catches its own per-hazard errors and returns
    // {status:"error"} — reaching here means something outside it threw.
    run.status = "error";
    run.error = err.message;
    run.finishedAt = new Date();
    await run.save();
    throw err;
  }

  run.status = "completed";
  run.finishedAt = new Date();
  run.hazards = {
    flood: { status: flood.status, version: flood.version ?? null, rowCount: flood.rowCount ?? null, error: flood.error ?? null },
    landslide: { status: landslide.status, version: landslide.version ?? null, rowCount: landslide.rowCount ?? null, error: landslide.error ?? null },
  };
  await run.save();

  console.log(
    `[TrainRiskModel] Training run complete — flood: ${flood.status}, landslide: ${landslide.status}`,
  );
  return { flood, landslide };
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
