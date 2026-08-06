/**
 * services/logisticRegression.js
 *
 * A small, hand-rolled, L2-regularized logistic regression — deliberately
 * not an npm ML package. At the dataset size this project will realistically
 * have (tens to low hundreds of labeled barangay-days), a heavier model
 * (random forest, gradient boosting, a Python/scikit-learn service) would
 * overfit and add opacity without adding accuracy. This file is the entire
 * "learning" mechanism: scripts/trainRiskModel.js calls trainLogisticRegression
 * on real accumulated report + weather data, and services/predictionEngine.js
 * calls predictProba with the resulting weights. Every retrain adjusts the
 * weights based on real reports — that's the literal mechanism by which the
 * model is supposed to get more accurate over time, not a fixed rule table.
 */

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
  };
  return featureNames.map((name) => PRIOR[name] ?? 0.3);
}

// Batch gradient descent, L2-regularized (bias term excluded from the
// penalty, standard practice). X rows are expected to already be
// standardized (see fitStandardization/applyStandardization above).
export function trainLogisticRegression(X, y, opts = {}) {
  const {
    initialWeights = null,
    initialBias = 0,
    l2 = 0.5,
    lr = 0.1,
    epochs = 400,
  } = opts;

  const n = X.length;
  const d = X[0]?.length ?? 0;
  let weights = initialWeights ? [...initialWeights] : new Array(d).fill(0);
  let bias = initialBias;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array(d).fill(0);
    let gradB = 0;

    for (let i = 0; i < n; i++) {
      const pred  = sigmoid(dot(X[i], weights) + bias);
      const error = pred - y[i];
      for (let j = 0; j < d; j++) gradW[j] += error * X[i][j];
      gradB += error;
    }

    for (let j = 0; j < d; j++) {
      weights[j] -= lr * (gradW[j] / n + l2 * weights[j]);
    }
    bias -= lr * (gradB / n);
  }

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
// reports one metrics set over the pooled results.
export function kFoldCrossValidate(X, y, opts = {}) {
  const { k = 5, ...trainOpts } = opts;
  const n = X.length;
  if (n < 4) return computeMetrics(y, X.map(() => 0.5)); // too small to fold meaningfully

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

    const { weights, bias } = trainLogisticRegression(trainX, trainY, trainOpts);
    for (let i = 0; i < testX.length; i++) {
      pooledTrue.push(testY[i]);
      pooledProb.push(predictProba(testX[i], weights, bias));
    }
  }

  return computeMetrics(pooledTrue, pooledProb);
}
