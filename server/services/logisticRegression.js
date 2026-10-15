/**
 * services/logisticRegression.js
 *
 * L2-regularized logistic regression, trained with TensorFlow.js
 * (@tensorflow/tfjs — pure-JS backend, no native compilation required) rather
 * than a hand-rolled gradient descent loop. Still deliberately a single dense
 * sigmoid unit, not a deeper network or ensemble: at the dataset size this
 * project will realistically have (tens to low hundreds of labeled
 * barangay-days), a heavier model (random forest, gradient boosting, a
 * multi-layer network) would overfit and add opacity without adding
 * accuracy. TensorFlow.js's SGD optimizer + binary cross-entropy loss +
 * L2 kernel regularizer replace the manual gradient math that used to live
 * here; scripts/trainRiskModel.js calls trainLogisticRegression on real
 * accumulated report + weather data, and services/predictionEngine.js calls
 * predictProba with the resulting weights. Every retrain adjusts the weights
 * based on real reports — that's the literal mechanism by which the model is
 * supposed to get more accurate over time, not a fixed rule table.
 *
 * predictProba/applyStandardization/fitStandardization stay plain JS (no
 * tfjs tensors) on purpose — live inference in predictionEngine.js runs on
 * every 30-min cron tick for 17 barangays x 2 hazard types, and a stored
 * weights/bias array plus a dot product is enough; there's no need to pay
 * tensor allocation cost for scoring, only for training.
 */

import * as tf from "@tensorflow/tfjs";

export function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

// Fits mean/std per feature from the training rows, for standardizing both
// training and (later) live inference inputs the same way. Guards against a
// constant feature (std === 0) producing NaN.
export function fitStandardization(X) {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  const means = new Array(d).fill(0);
  const stds  = new Array(d).fill(1);

  for (let j = 0; j < d; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += X[i][j];
    means[j] = n > 0 ? sum / n : 0;
  }
  for (let j = 0; j < d; j++) {
    let sq = 0;
    for (let i = 0; i < n; i++) sq += (X[i][j] - means[j]) ** 2;
    const std = n > 0 ? Math.sqrt(sq / n) : 0;
    stds[j] = std > 1e-8 ? std : 1;
  }
  return { means, stds };
}

export function applyStandardization(x, means, stds) {
  return x.map((v, j) => (v - means[j]) / stds[j]);
}

// A mild, hand-set informative prior — every feature here is intuitively
// risk-increasing (more rain, wetter soil, a history of reports, documented
// slope susceptibility), so starting weights are small positive numbers
// rather than zero. This is what keeps day-one predictions sane before any
// real training data exists; L2 regularization pulls these toward zero if
// the actual data disagrees, and gradient descent moves them from there.
// Order must match services/riskFeatures.js FEATURE_NAMES.
export function defaultPriorWeights(featureNames) {
  const PRIOR = {
    rain_6h: 0.9,
    rain_24h: 0.5,
    soilTop: 0.7,
    soilDeep: 0.5,
    barangayReportRate30d: 0.4,
    susceptibility: 0.6,
    // Higher river discharge is a direct flood signal, comparable in
    // strength to the rain features. Higher wind speed correlates with
    // storm systems. Lower surface pressure correlates with storm systems,
    // hence a negative prior (risk rises as pressure falls). Evapotranspiration's
    // relationship to risk is weaker/less direct than the others, so its
    // prior stays small.
    riverDischarge: 0.8,
    windSpeed10m: 0.3,
    surfacePressure: -0.3,
    et0_24h: -0.1,
  };
  return featureNames.map((name) => PRIOR[name] ?? 0.3);
}

// L2-regularized logistic regression, trained via TensorFlow.js: a single
// dense unit with sigmoid activation is mathematically exactly logistic
// regression (z = w.x + b, p = sigmoid(z)), fit with SGD + binary
// cross-entropy loss. tf.regularizers.l2 penalizes the kernel (weights) only
// — the bias is excluded from the penalty by default, matching standard
// practice (and the previous hand-rolled implementation). X rows are
// expected to already be standardized (see fitStandardization/
// applyStandardization above). Returns plain-JS arrays, not tensors, so
// callers (and the RiskModel Mongoose schema) never need to know tfjs is
// involved.
export async function trainLogisticRegression(X, y, opts = {}) {
  const {
    initialWeights = null,
    initialBias = 0,
    l2 = 0.5,
    lr = 0.1,
    epochs = 400,
  } = opts;

  const n = X.length;
  const d = X[0]?.length ?? 0;

  const model = tf.sequential({
    layers: [
      tf.layers.dense({
        inputShape: [d],
        units: 1,
        activation: "sigmoid",
        kernelRegularizer: tf.regularizers.l2({ l2 }),
      }),
    ],
  });
  model.compile({ optimizer: tf.train.sgd(lr), loss: "binaryCrossentropy" });

  // Seed with the informed prior (or zeros) instead of tfjs's random default
  // init — this is what keeps day-one predictions sane before real training
  // data exists (see defaultPriorWeights below).
  const kernelInit = tf.tensor2d(initialWeights ? [...initialWeights] : new Array(d).fill(0), [d, 1]);
  const biasInit = tf.tensor1d([initialBias]);
  model.setWeights([kernelInit, biasInit]);
  kernelInit.dispose();
  biasInit.dispose();

  const xs = tf.tensor2d(X);
  const ys = tf.tensor2d(y, [n, 1]);

  // Balanced per-class weights (the standard n / (nClasses * classCount)
  // heuristic, as in sklearn's class_weight="balanced"). Positives are
  // ~0.3-0.5% of rows, so with unweighted binary cross-entropy the averaged
  // gradient is dominated by the negative majority and never overcomes the
  // l2 pull each epoch (weights[j] *= (1 - lr*l2) every epoch regardless of
  // data) — after `epochs` iterations that shrinkage erases the informative
  // prior and collapses weights toward ~0, leaving the model unable to
  // discriminate between barangays/conditions (all predictions ~= sigmoid(bias)).
  // Reweighting so both classes contribute equally to the loss gives the
  // rare positive class enough gradient signal to actually move the weights.
  // (tfjs-layers' `sampleWeight` fit option throws "not supported yet" on
  // this backend — `classWeight` takes the equivalent per-sample path
  // internally for a single-column y of exact 0/1 values, which is what
  // ys here is, so it's used instead.)
  const positiveCount = y.reduce((sum, v) => sum + v, 0);
  const negativeCount = n - positiveCount;
  const posWeight = positiveCount > 0 ? n / (2 * positiveCount) : 1;
  const negWeight = negativeCount > 0 ? n / (2 * negativeCount) : 1;
  const classWeight = { 0: negWeight, 1: posWeight };

  // yieldEvery: "never" skips tfjs's default per-epoch yield to the event
  // loop (meant to keep a browser UI responsive during training) — this runs
  // headless in a Node script/cron with no UI to protect, and the yields
  // otherwise add real wall-clock time with no benefit here.
  await model.fit(xs, ys, { epochs, batchSize: n, verbose: 0, yieldEvery: "never", classWeight });

  // getWeights() returns references into the model's own LayerVariables, not
  // independent tensors — read their data out to plain arrays first, then let
  // model.dispose() free them along with the rest of the model (disposing
  // them separately here would double-free and throw).
  const [kernelTensor, biasTensor] = model.getWeights();
  const weights = Array.from(await kernelTensor.data());
  const bias = (await biasTensor.data())[0];

  xs.dispose();
  ys.dispose();
  model.dispose();

  return { weights, bias };
}

export function predictProba(x, weights, bias) {
  return sigmoid(dot(x, weights) + bias);
}

// Precision/recall/F1 at a fixed threshold, plus a rank-based AUC
// (Mann-Whitney U / (pos*neg)) — robust at small N and doesn't require
// picking a threshold to compute.
export function computeMetrics(yTrue, yProb, threshold = 0.5) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (let i = 0; i < yTrue.length; i++) {
    const pred = yProb[i] >= threshold ? 1 : 0;
    if (pred === 1 && yTrue[i] === 1) tp++;
    else if (pred === 1 && yTrue[i] === 0) fp++;
    else if (pred === 0 && yTrue[i] === 1) fn++;
    else tn++;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall    = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 =
    precision != null && recall != null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;

  const pos = [], neg = [];
  for (let i = 0; i < yTrue.length; i++) (yTrue[i] === 1 ? pos : neg).push(yProb[i]);
  let auc = null;
  if (pos.length > 0 && neg.length > 0) {
    let concordant = 0;
    for (const p of pos) for (const q of neg) {
      if (p > q) concordant += 1;
      else if (p === q) concordant += 0.5;
    }
    auc = concordant / (pos.length * neg.length);
  }

  return { precision, recall, f1, auc, tp, fp, fn, tn };
}

// Scans candidate thresholds and returns the one maximizing F1. Necessary
// because flood/landslide positives are a tiny fraction of rows (~0.5%/0.3%
// of barangay-days in this project's historical data) — predicted
// probabilities for even the riskiest days stay well under the conventional
// default of 0.5, so reporting metrics (or gating live alerts) at 0.5 shows
// recall=0 not because the model failed, but because nothing ever crosses
// that line. This finds the threshold that actually separates positives from
// negatives in the model's own output range.
export function findOptimalThreshold(yTrue, yProb, opts = {}) {
  const { steps = 199 } = opts; // ~0.005 granularity across (0, 1)
  let best = { threshold: 0.5, f1: -1 };
  for (let i = 1; i < steps; i++) {
    const threshold = i / steps;
    const { f1 } = computeMetrics(yTrue, yProb, threshold);
    if (f1 != null && f1 > best.f1) best = { threshold, f1 };
  }
  return best.threshold;
}

function shuffledIndices(n) {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

// k-fold cross-validation — appropriate at small N (vs. a single held-out
// split, which at N in the dozens could easily land all positives in one
// side). Trains a fresh model per fold, pools all held-out predictions, and
// reports one metrics set over the pooled results. Also returns the pooled
// (yTrue, yProb) arrays themselves so a caller can pick an operating
// threshold (see findOptimalThreshold) from real held-out predictions rather
// than from training-set predictions, which would bias the threshold choice.
export async function kFoldCrossValidate(X, y, opts = {}) {
  const { k = 5, ...trainOpts } = opts;
  const n = X.length;
  if (n < 4) {
    const pooledProb = X.map(() => 0.5);
    return { metrics: computeMetrics(y, pooledProb), pooledTrue: y, pooledProb }; // too small to fold meaningfully
  }

  const kEff = Math.max(2, Math.min(k, n));
  const order = shuffledIndices(n);
  const folds = Array.from({ length: kEff }, () => []);
  order.forEach((idx, i) => folds[i % kEff].push(idx));

  const pooledTrue = [];
  const pooledProb = [];

  for (let f = 0; f < kEff; f++) {
    const testSet = new Set(folds[f]);
    const trainX = [], trainY = [], testX = [], testY = [];
    for (let i = 0; i < n; i++) {
      if (testSet.has(i)) { testX.push(X[i]); testY.push(y[i]); }
      else { trainX.push(X[i]); trainY.push(y[i]); }
    }
    if (trainX.length === 0 || testX.length === 0) continue;

    const { weights, bias } = await trainLogisticRegression(trainX, trainY, trainOpts);
    for (let i = 0; i < testX.length; i++) {
      pooledTrue.push(testY[i]);
      pooledProb.push(predictProba(testX[i], weights, bias));
    }
  }

  return { metrics: computeMetrics(pooledTrue, pooledProb), pooledTrue, pooledProb };
}
