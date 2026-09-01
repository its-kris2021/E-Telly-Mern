// models/RiskModel.js
//
// A trained (or prior-initialized) logistic regression for one hazard type
// (flood or landslide). Stored in Mongo rather than a file on disk since
// deployment hosts (Render/Railway-style) don't guarantee persistent local
// disk across restarts, but MongoDB already is the durable store for
// everything else in this app. Versioned rather than overwritten so
// scripts/trainRiskModel.js can show a metrics history across retrains —
// the artifact the capstone defense uses to show the model improving (or
// honestly, calibrating) as more report data accumulates.
import mongoose from "mongoose";

const RiskModelSchema = new mongoose.Schema({
  hazardType: { type: String, enum: ["flood", "landslide"], required: true, index: true },
  version:    { type: Number, required: true },

  // Ordered to match services/riskFeatures.js FEATURE_NAMES exactly.
  featureNames: [String],
  weights:      [Number],
  bias:         { type: Number, default: 0 },
  // Standardization params (fit on the training set) — predictionEngine.js
  // must apply the same (x - mean) / std transform before scoring live features.
  featureMeans: [Number],
  featureStds:  [Number],

  trainingSetSize: { type: Number, default: 0 },
  positiveCount:   { type: Number, default: 0 },

  // Offline cross-validation metrics (model quality at training time), at
  // the conventional 0.5 threshold — kept for comparability across models,
  // but with positives at ~0.5%/0.3% of rows this is nearly always
  // precision=n/a, recall=0: predicted probabilities never climb that high.
  // See operatingThreshold/metricsAtOperatingThreshold for the metrics that
  // actually reflect this model's real discriminative power.
  metrics: {
    precision: { type: Number, default: null },
    recall:    { type: Number, default: null },
    f1:        { type: Number, default: null },
    auc:       { type: Number, default: null },
  },

  // The probability cutoff that maximizes F1 on pooled cross-validation
  // predictions (services/logisticRegression.js findOptimalThreshold) —
  // calculated once per training run and reused by both the metrics below
  // and services/predictionEngine.js's live alert gate, so "does this look
  // like a risk day" is judged by a threshold actually calibrated to this
  // model's output range, not a fixed guess.
  operatingThreshold: { type: Number, default: 0.5 },
  metricsAtOperatingThreshold: {
    precision: { type: Number, default: null },
    recall:    { type: Number, default: null },
    f1:        { type: Number, default: null },
  },

  // Live, post-hoc field performance — recomputed on each retrain from
  // confirmed AI-source Alert outcomes (see services/alertHelpers.js
  // upsertAiAlert / routes/alerts.js confirm/reject). Distinct from `metrics`
  // above: this tells you how predictions actually did in the field, not
  // just on held-out historical data.
  fieldMetrics: {
    truePositives:  { type: Number, default: 0 },
    falsePositives: { type: Number, default: 0 },
    precision:      { type: Number, default: null },
  },

  isActive: { type: Boolean, default: false },
  notes:    { type: String, default: "" },
  trainedAt: { type: Date, default: Date.now },
});

RiskModelSchema.index({ hazardType: 1, isActive: 1 });
RiskModelSchema.index({ hazardType: 1, version: -1 });

export default mongoose.model("RiskModel", RiskModelSchema);
