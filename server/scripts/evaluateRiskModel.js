/**
 * scripts/evaluateRiskModel.js
 *
 * READ-ONLY honest evaluation of the flood/landslide risk models, for the
 * thesis panel. Does NOT write to MongoDB and does not modify any existing
 * file — it only reads data and writes two local report files under
 * scripts/output/.
 *
 * Why this exists: trainRiskModel.js reports cross-validated AUC (~0.91
 * flood, ~0.94 landslide) using logisticRegression.js's kFoldCrossValidate,
 * which shuffles ROWS randomly into folds. Rows from the same storm/report
 * cluster are highly correlated (nearby days, overlapping 30-day report-rate
 * windows), so a random split can land correlated rows on both sides of a
 * fold — the classic way CV overstates real out-of-time performance. This
 * script instead holds out the most recent calendar period entirely (no
 * shuffling), which is the honest way to ask "how would this have done on
 * days it never saw during training."
 *
 * Usage: node scripts/evaluateRiskModel.js [flood|landslide|both]
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { loadSharedTrainingData, buildTrainingSet } from "./buildTrainingSet.js";
import { FEATURE_NAMES } from "../services/riskFeatures.js";
import { BARANGAY_KEYS } from "../config/barangays.js";
import {
  fitStandardization,
  applyStandardization,
  trainLogisticRegression,
  predictProba,
  computeMetrics,
  findOptimalThreshold,
  defaultPriorWeights,
} from "../services/logisticRegression.js";

// ── Config — change these to re-run with different splits ──────────────────
const TEST_MONTHS = 12;
const VALIDATION_MONTHS = 6;
const BOOTSTRAP_RESAMPLES = 1000;
const MIN_TEST_POSITIVES_WARNING = 10;
// Same hyperparameters trainRiskModel.js uses, so this is an apples-to-apples
// comparison of the SAME training recipe under a different (honest) split —
// not a differently-tuned model.
const TRAIN_OPTS = { initialBias: 0, l2: 0.5, lr: 0.1, epochs: 400 };

// PAGASA / MGB thresholds — restated here (not imported) because
// floodAlerts.js/landslideAlerts.js only export check-and-alert FUNCTIONS,
// not these constants. Values copied verbatim from those files; if they
// ever change there, this script's rule baseline will silently go stale —
// worth a comment linking back, not worth importing private module state.
const RULE = {
  YELLOW: 7.5, ORANGE: 15, RED: 30,          // mm/hr, floodAlerts.js / landslideAlerts.js
  SOIL_SATURATED: 0.35, SOIL_ELEVATED: 0.25, SOIL_RISING: 0.20, // landslideAlerts.js
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const REPORT_RATE_IDX = FEATURE_NAMES.indexOf("barangayReportRate30d");
const NO_RATE_FEATURE_NAMES = FEATURE_NAMES.filter((n) => n !== "barangayReportRate30d");

// ── Rule-based baseline ──────────────────────────────────────────────────
// IMPORTANT APPROXIMATION: the live rule engine looks at FORECAST rainfall
// in future windows (0-1h, 1-3h, 3-6h, 6-12h ahead) — that can't be replayed
// against history because we only ever captured what already happened.
// The closest available observed stand-in is rain_1h (trailing 1-hour
// accumulation at capture time, i.e. an observed mm/hr-equivalent reading).
// This substitutes that single observed reading for every forecast window
// the real rules check, which means this baseline is structurally easier to
// satisfy at the lower tiers (watch) than the live system — it is a
// reasonable approximation of "would the rule thresholds have been crossed
// that day," NOT a replay of the live alert engine.
function floodRuleFlag(rain1h, soilAvg) {
  if (rain1h >= RULE.RED && soilAvg > RULE.SOIL_SATURATED) return true; // evacuate
  if (rain1h >= RULE.RED) return true;                                  // critical
  if (rain1h >= RULE.ORANGE) return true;                               // warning
  if (rain1h >= RULE.YELLOW) return true;                                // watch
  return false;
}
function landslideRuleFlag(rain1h, soilAvg) {
  if (rain1h >= RULE.RED && soilAvg > RULE.SOIL_SATURATED) return true;        // evacuate
  if (rain1h >= RULE.RED && soilAvg > RULE.SOIL_ELEVATED) return true;         // critical
  if (rain1h >= RULE.ORANGE) return true;                                      // warning
  if (rain1h >= RULE.YELLOW && soilAvg > RULE.SOIL_RISING) return true;       // watch
  return false;
}

// ── Date-based split (no shuffling) ─────────────────────────────────────
function shiftMonths(dayKey, months) {
  const d = new Date(`${dayKey}T00:00:00+08:00`);
  d.setMonth(d.getMonth() - months);
  return d.toLocaleString("en-CA", { timeZone: "Asia/Manila" }).slice(0, 10);
}

function splitByDate(rows, testMonths, valMonths) {
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  const lastDay = sorted[sorted.length - 1].day;
  const testStartKey = shiftMonths(lastDay, testMonths);
  const valStartKey = shiftMonths(testStartKey, valMonths);

  return {
    train: sorted.filter((r) => r.day < valStartKey),
    val: sorted.filter((r) => r.day >= valStartKey && r.day < testStartKey),
    test: sorted.filter((r) => r.day >= testStartKey),
    valStartKey,
    testStartKey,
  };
}

function dropFeature(rows, idx) {
  return rows.map((r) => ({ ...r, features: r.features.filter((_, i) => i !== idx) }));
}

// ── Average precision (PR-AUC), standard rank-based estimator ──────────────
function averagePrecision(yTrue, yProb) {
  const totalPos = yTrue.reduce((s, v) => s + v, 0);
  if (totalPos === 0) return null;
  const order = yTrue.map((_, i) => i).sort((a, b) => yProb[b] - yProb[a]);
  let tp = 0, fp = 0, apSum = 0, prevRecall = 0;
  for (const i of order) {
    if (yTrue[i] === 1) tp++; else fp++;
    const precision = tp / (tp + fp);
    const recall = tp / totalPos;
    apSum += precision * (recall - prevRecall);
    prevRecall = recall;
  }
  return apSum;
}

// ── Bootstrap CI, resampling whole DATES (not rows) ─────────────────────
// Cheap because predictProba was already run once for every test row — a
// resample just re-groups already-computed (label, probability) pairs by
// day, so 1000 iterations costs 1000 array joins, not 1000 model scorings.
function bootstrapByDate(testRows, yTest, probTest, threshold, nResamples) {
  const dayToIdx = new Map();
  testRows.forEach((r, i) => {
    if (!dayToIdx.has(r.day)) dayToIdx.set(r.day, []);
    dayToIdx.get(r.day).push(i);
  });
  const days = [...dayToIdx.keys()];
  const aucs = [], recalls = [];

  for (let b = 0; b < nResamples; b++) {
    const idxs = [];
    for (let i = 0; i < days.length; i++) {
      const d = days[Math.floor(Math.random() * days.length)];
      idxs.push(...dayToIdx.get(d));
    }
    const y = idxs.map((i) => yTest[i]);
    const p = idxs.map((i) => probTest[i]);
    const totalPos = y.reduce((s, v) => s + v, 0);
    if (totalPos === 0 || totalPos === y.length) continue; // AUC undefined if one class is absent
    const m = computeMetrics(y, p, threshold);
    if (m.auc != null) aucs.push(m.auc);
    if (m.recall != null) recalls.push(m.recall);
  }

  const pct = (arr, p) => {
    const s = [...arr].sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null;
  };
  return {
    auc: { lo: pct(aucs, 0.025), hi: pct(aucs, 0.975), nValid: aucs.length },
    recall: { lo: pct(recalls, 0.025), hi: pct(recalls, 0.975), nValid: recalls.length },
  };
}

// ── Train one variant (full features, or ablated) on the date-based split ──
async function evaluateVariant(trainRows, valRows, testRows, featureNames) {
  const Xtrain = trainRows.map((r) => r.features);
  const ytrain = trainRows.map((r) => r.label);
  const { means, stds } = fitStandardization(Xtrain);
  const XtrainStd = Xtrain.map((x) => applyStandardization(x, means, stds));

  const initialWeights = defaultPriorWeights(featureNames);
  const { weights, bias } = await trainLogisticRegression(XtrainStd, ytrain, { ...TRAIN_OPTS, initialWeights });

  const Xval = valRows.map((r) => applyStandardization(r.features, means, stds));
  const yval = valRows.map((r) => r.label);
  const probVal = Xval.map((x) => predictProba(x, weights, bias));
  const threshold = findOptimalThreshold(yval, probVal);

  const Xtest = testRows.map((r) => applyStandardization(r.features, means, stds));
  const ytest = testRows.map((r) => r.label);
  const probTest = Xtest.map((x) => predictProba(x, weights, bias));

  const m = computeMetrics(ytest, probTest, threshold);
  const prAuc = averagePrecision(ytest, probTest);
  const ci = bootstrapByDate(testRows, ytest, probTest, threshold, BOOTSTRAP_RESAMPLES);

  const testDays = new Set(testRows.map((r) => r.day)).size;
  const fpPer30DaysAllBarangays = (m.fp / testDays) * 30;
  const fpPerBarangayPerMonth = fpPer30DaysAllBarangays / BARANGAY_KEYS.length;

  return {
    threshold, rocAuc: m.auc, prAuc,
    precision: m.precision, recall: m.recall, f1: m.f1,
    confusion: { tp: m.tp, fp: m.fp, fn: m.fn, tn: m.tn },
    fpPer30DaysAllBarangays, fpPerBarangayPerMonth,
    ci, testN: testRows.length, testPositives: ytest.reduce((s, v) => s + v, 0),
    predAt: probTest.map((p) => (p >= threshold ? 1 : 0)), // per-row prediction, for overlap comparison
  };
}

function evaluateAlwaysNo(testRows) {
  const totalPos = testRows.reduce((s, r) => s + r.label, 0);
  const testDays = new Set(testRows.map((r) => r.day)).size;
  return {
    precision: null, recall: 0, f1: null,
    confusion: { tp: 0, fp: 0, fn: totalPos, tn: testRows.length - totalPos },
    fpPer30DaysAllBarangays: 0, fpPerBarangayPerMonth: 0,
    testN: testRows.length, testPositives: totalPos, rocAuc: null, prAuc: null,
  };
}

function evaluateRuleBaseline(hazardType, testRows, snapshotByKey) {
  const flagFn = hazardType === "flood" ? floodRuleFlag : landslideRuleFlag;
  const soilTopIdx = FEATURE_NAMES.indexOf("soilTop");
  const soilDeepIdx = FEATURE_NAMES.indexOf("soilDeep");

  let tp = 0, fp = 0, fn = 0, tn = 0;
  const pred = [];
  for (const r of testRows) {
    const snap = snapshotByKey.get(`${r.barangay}|${r.day}`);
    const rain1h = snap?.rain_1h ?? 0;
    const soilAvg = (r.features[soilTopIdx] + r.features[soilDeepIdx]) / 2;
    const flag = flagFn(rain1h, soilAvg) ? 1 : 0;
    pred.push(flag);
    if (flag === 1 && r.label === 1) tp++;
    else if (flag === 1 && r.label === 0) fp++;
    else if (flag === 0 && r.label === 1) fn++;
    else tn++;
  }

  const testDays = new Set(testRows.map((r) => r.day)).size;
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 = precision != null && recall != null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall) : null;

  return {
    precision, recall, f1,
    confusion: { tp, fp, fn, tn },
    fpPer30DaysAllBarangays: (fp / testDays) * 30,
    fpPerBarangayPerMonth: (fp / testDays) * 30 / BARANGAY_KEYS.length,
    testN: testRows.length, testPositives: tp + fn, pred,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  const arg = (process.argv[2] ?? "both").toLowerCase();
  const hazards = arg === "both" ? ["flood", "landslide"] : [arg];
  if (!hazards.every((h) => h === "flood" || h === "landslide")) {
    console.error('Usage: node scripts/evaluateRiskModel.js [flood|landslide|both]');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB (read-only — no writes will be made).\n");

  const sharedData = await loadSharedTrainingData();
  const snapshotByKey = new Map(sharedData.snapshots.map((s) => [`${s.barangay}|${s.day}`, s]));

  const allResults = {};

  for (const hazardType of hazards) {
    console.log(`\n${"=".repeat(60)}\n${hazardType.toUpperCase()}\n${"=".repeat(60)}`);
    const { rows } = await buildTrainingSet(hazardType, sharedData);
    const { train, val, test, valStartKey, testStartKey } = splitByDate(rows, TEST_MONTHS, VALIDATION_MONTHS);

    const testPositives = test.reduce((s, r) => s + r.label, 0);
    console.log(`Split — train: ${train.length} rows (< ${valStartKey}), ` +
      `val: ${val.length} rows [${valStartKey}, ${testStartKey}), test: ${test.length} rows (>= ${testStartKey})`);
    console.log(`Test positives: ${testPositives}`);
    if (testPositives < MIN_TEST_POSITIVES_WARNING) {
      console.warn(`WARNING: test set has only ${testPositives} positive(s) for ${hazardType} — ` +
        `metrics below (especially recall/PR-AUC) rest on a very small sample and should be treated ` +
        `as rough, not precise.`);
    }

    const full = await evaluateVariant(train, val, test, FEATURE_NAMES);
    const noRate = await evaluateVariant(
      dropFeature(train, REPORT_RATE_IDX), dropFeature(val, REPORT_RATE_IDX), dropFeature(test, REPORT_RATE_IDX),
      NO_RATE_FEATURE_NAMES,
    );
    const ruleBaseline = evaluateRuleBaseline(hazardType, test, snapshotByKey);
    const alwaysNo = evaluateAlwaysNo(test);

    const modelOnly = test.filter((_, i) => full.predAt[i] === 1 && ruleBaseline.pred[i] === 0 && test[i].label === 1).length;
    const ruleOnly = test.filter((_, i) => ruleBaseline.pred[i] === 1 && full.predAt[i] === 0 && test[i].label === 1).length;

    allResults[hazardType] = {
      split: { trainN: train.length, valN: val.length, testN: test.length, valStartKey, testStartKey },
      variants: { full, noReportRate: noRate },
      ruleBaseline, alwaysNo,
      overlap: { modelCatchesRuleMisses: modelOnly, ruleCatchesModelMisses: ruleOnly },
    };

    printHazardTable(hazardType, allResults[hazardType]);
  }

  await writeOutputFiles(allResults);
  await mongoose.disconnect();
}

function fmt(v, d = 3) { return v == null ? "n/a" : v.toFixed(d); }

function printHazardTable(hazardType, r) {
  const rows = [
    ["Model (all features)", r.variants.full],
    ["Model (no reportRate30d)", r.variants.noReportRate],
    ["Rule baseline", r.ruleBaseline],
    ["Always-no baseline", r.alwaysNo],
  ];
  console.log(`\n${"Variant".padEnd(26)}${"N".padEnd(7)}${"Pos".padEnd(6)}${"ROC-AUC".padEnd(10)}` +
    `${"PR-AUC".padEnd(9)}${"Thresh".padEnd(8)}${"Prec".padEnd(7)}${"Recall".padEnd(8)}${"F1".padEnd(7)}${"FP/brgy/mo"}`);
  for (const [label, v] of rows) {
    console.log(
      label.padEnd(26) + String(v.testN).padEnd(7) + String(v.testPositives).padEnd(6) +
      fmt(v.rocAuc).padEnd(10) + fmt(v.prAuc).padEnd(9) + fmt(v.threshold).padEnd(8) +
      fmt(v.precision).padEnd(7) + fmt(v.recall).padEnd(8) + fmt(v.f1).padEnd(7) +
      fmt(v.fpPerBarangayPerMonth, 2),
    );
  }
  console.log(`Confusion (model, all features): TP=${r.variants.full.confusion.tp} FP=${r.variants.full.confusion.fp} ` +
    `FN=${r.variants.full.confusion.fn} TN=${r.variants.full.confusion.tn}`);
  console.log(`Confusion (rule baseline):       TP=${r.ruleBaseline.confusion.tp} FP=${r.ruleBaseline.confusion.fp} ` +
    `FN=${r.ruleBaseline.confusion.fn} TN=${r.ruleBaseline.confusion.tn}`);
  if (r.variants.full.ci) {
    console.log(`95% CI (bootstrap, n=${BOOTSTRAP_RESAMPLES}, resampled by date): ` +
      `ROC-AUC [${fmt(r.variants.full.ci.auc.lo)}, ${fmt(r.variants.full.ci.auc.hi)}] ` +
      `(${r.variants.full.ci.auc.nValid} valid resamples), ` +
      `Recall [${fmt(r.variants.full.ci.recall.lo)}, ${fmt(r.variants.full.ci.recall.hi)}] ` +
      `(${r.variants.full.ci.recall.nValid} valid resamples)`);
  }
  console.log(`Overlap: model catches ${r.overlap.modelCatchesRuleMisses} test positive(s) the rule baseline misses; ` +
    `rule baseline catches ${r.overlap.ruleCatchesModelMisses} the model misses.`);
}

async function writeOutputFiles(allResults) {
  const outDir = path.join(__dirname, "output");
  fs.mkdirSync(outDir, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);
  const jsonPath = path.join(outDir, `evaluation-${dateStr}.json`);
  const mdPath = path.join(outDir, `evaluation-${dateStr}.md`);

  const payload = {
    generatedAt: new Date().toISOString(),
    config: { TEST_MONTHS, VALIDATION_MONTHS, BOOTSTRAP_RESAMPLES, TRAIN_OPTS },
    results: allResults,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));

  let md = `# Risk model evaluation — ${dateStr}\n\n`;
  md += `Time-based holdout (no shuffling): test = most recent ${TEST_MONTHS} months, ` +
    `validation = the ${VALIDATION_MONTHS} months before that, train = everything older. ` +
    `Threshold chosen on validation only (F1-argmax), applied fixed to test.\n\n`;

  for (const [hazardType, r] of Object.entries(allResults)) {
    md += `## ${hazardType}\n\n`;
    md += `Split: train=${r.split.trainN}, val=${r.split.valN}, test=${r.split.testN} ` +
      `(val starts ${r.split.valStartKey}, test starts ${r.split.testStartKey})\n\n`;
    md += `| Variant | N | Pos | ROC-AUC | PR-AUC | Threshold | Precision | Recall | F1 | FP/barangay/mo |\n`;
    md += `|---|---|---|---|---|---|---|---|---|---|\n`;
    const row = (label, v) => `| ${label} | ${v.testN} | ${v.testPositives} | ${fmt(v.rocAuc)} | ${fmt(v.prAuc)} | ` +
      `${fmt(v.threshold)} | ${fmt(v.precision)} | ${fmt(v.recall)} | ${fmt(v.f1)} | ${fmt(v.fpPerBarangayPerMonth, 2)} |\n`;
    md += row("Model (all features)", r.variants.full);
    md += row("Model (no reportRate30d)", r.variants.noReportRate);
    md += row("Rule baseline (approximated)", r.ruleBaseline);
    md += row("Always-no baseline", r.alwaysNo);
    md += `\nOverlap: model catches ${r.overlap.modelCatchesRuleMisses} test positive(s) the rule baseline misses; ` +
      `rule baseline catches ${r.overlap.ruleCatchesModelMisses} the model misses.\n\n`;
  }

  md += `## Limitations\n\n`;
  md += `- Small number of positives per hazard (see "Pos" column) — recall/PR-AUC estimates rest on a ` +
    `handful of events and should be read as rough, not precise.\n`;
  md += `- Labels come from citizen/CDRRMO reports, not ground-truth hazard occurrence — "no report" may ` +
    `mean "no event" or may mean "an event happened and nobody reported it."\n`;
  md += `- The rule baseline uses OBSERVED trailing rain_1h as a stand-in for the live system's FORECAST ` +
    `peak-intensity windows (0-1h/1-3h/3-6h/6-12h ahead) — it approximates whether rule thresholds would ` +
    `have been crossed, it does not replay the live alert engine.\n`;
  md += `- Test-set size (see split above) is bounded by how much historical data exists; the most recent ` +
    `${TEST_MONTHS} months may not be representative of a full multi-year rainy/dry season cycle.\n`;
  fs.writeFileSync(mdPath, md);

  console.log(`\nWrote: ${jsonPath}\nWrote: ${mdPath}`);
}

main().catch((err) => {
  console.error("Evaluation failed:", err);
  process.exit(1);
});
