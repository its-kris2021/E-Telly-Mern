/**
 * services/predictionEngine.js
 *
 * The AI half of the hazard map: for each barangay, scores the currently
 * active flood and landslide RiskModel docs (server/models/RiskModel.js,
 * trained by scripts/trainRiskModel.js) against live conditions, and
 * surfaces high-probability predictions as source:"ai" Alerts.
 *
 * Gated against the existing rule engine (services/floodAlerts.js,
 * services/landslideAlerts.js) on purpose: this should surface risk the
 * physics-based PAGASA/soil-moisture rules are missing, not duplicate or
 * contradict what they already caught, so the map never shows two
 * conflicting markers for the same barangay/hazard.
 */

import mongoose from "mongoose";
import Alert from "../models/Alert.js";
import RiskModel from "../models/RiskModel.js";
import { BARANGAY_COORDS, barangayLabel } from "../config/barangays.js";
import { fetchWeatherSnapshotBatch, fetchRiverDischargeBatch } from "./openMeteoCache.js";
import { extractSnapshotFeatures, extractRiverDischargeFeature } from "./weatherSnapshotService.js";
import { computeBarangayReportRate, susceptibilityFeature, toFeatureVector } from "./riskFeatures.js";
import { applyStandardization, predictProba } from "./logisticRegression.js";
import { toDateKey, upsertAiAlert } from "./alertHelpers.js";

const HAZARD_TYPES = ["flood", "landslide"];
// Fallback only, for RiskModel docs trained before per-model calibrated
// thresholds existed (see scripts/trainRiskModel.js operatingThreshold).
// Flood/landslide positives are ~0.5%/0.3% of historical barangay-days, so a
// fixed threshold this high would almost never fire — each model's own
// F1-maximizing operatingThreshold is what actually gates alerts below.
const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;
const SEVERITY_RANK = { watch: 1, warning: 2, critical: 3, evacuate: 4 };

const BARANGAYS = Object.entries(BARANGAY_COORDS).map(([key, coord]) => ({ key, coord }));

async function loadActiveModels() {
  const models = {};
  for (const hazardType of HAZARD_TYPES) {
    models[hazardType] = await RiskModel.findOne({ hazardType, isActive: true }).lean();
  }
  return models;
}

// Severity bands scaled relative to the model's own operating threshold,
// not fixed absolute probabilities — with positives at ~0.5%/0.3% of rows,
// probabilities in this model's real output range rarely approach 0.7/0.85,
// so fixed bands would classify nearly every AI alert as "watch" regardless
// of how confident the model actually is relative to its own calibration.
// Splits the remaining headroom between threshold and 1.0 into thirds.
function severityFromProbability(prob, threshold) {
  const headroom = 1 - threshold;
  if (prob >= threshold + headroom * 0.6) return "critical";
  if (prob >= threshold + headroom * 0.3) return "warning";
  return "watch";
}

async function ruleEngineAlreadyCovers(barangayKey, hazardType, minSeverityRank) {
  const existing = await Alert.find({
    source: "system",
    type: hazardType,
    barangays: barangayKey,
    isActive: true,
  }).lean();
  return existing.some((a) => (SEVERITY_RANK[a.severity] ?? 0) >= minSeverityRank);
}

async function checkBarangayHazard({ key, coord, hazardType, model, weatherRaw, dischargeRaw, barangayReportRate30d }) {
  if (!model) return null;

  const named = {
    ...extractSnapshotFeatures(weatherRaw),
    riverDischarge: dischargeRaw ? extractRiverDischargeFeature(dischargeRaw) : 0,
    barangayReportRate30d,
    susceptibility: susceptibilityFeature(key, hazardType),
  };
  const vector = toFeatureVector(named);
  const standardized = applyStandardization(vector, model.featureMeans, model.featureStds);
  const probability = predictProba(standardized, model.weights, model.bias);

  const threshold = model.operatingThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  if (probability < threshold) return probability;

  const severity = severityFromProbability(probability, threshold);
  if (await ruleEngineAlreadyCovers(key, hazardType, SEVERITY_RANK[severity])) return probability;

  const barangayName = barangayLabel(key);
  const confidencePct = Math.round(probability * 100);
  const hazardLabel = hazardType === "flood" ? "Flood" : "Landslide";

  await upsertAiAlert({
    _dedupeKey: `ai_${hazardType}_${key}_${toDateKey()}`,
    type: hazardType,
    severity,
    title: `AI-Predicted ${hazardLabel} Risk — Barangay ${barangayName}`,
    description:
      `The risk model estimates a ${confidencePct}% chance of a ${hazardType} report in Barangay ` +
      `${barangayName} based on current rainfall, soil moisture, and this area's report history ` +
      `(model v${model.version}). This is a statistical prediction, not a confirmed hazard — it has ` +
      `not been verified by a rule-based check or an admin.`,
    barangays: [key],
    location: `${coord.lat},${coord.lng}`,
    lat: coord.lat, lng: coord.lng,
    confidence: probability,
    modelVersion: `${hazardType}-v${model.version}`,
    // Was 6h — too short for a human to actually review (the Oct-19 audit
    // found 22/22 AI alerts all-time auto-expired unreviewed, 6h never gave
    // the review UI (AiPredictionReviewPanel.jsx) a real chance to be seen)
    // and shorter than citizen reports can legitimately lag via offline mesh
    // relay (riskFeatures.js's barangayReportRate30d comment). 24h instead —
    // long enough for a daily check-in and for a delayed matching report to
    // still land while the alert is active.
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  console.log(`[PredictionEngine] ${hazardType}/${key} — probability=${probability.toFixed(2)} severity=${severity}`);
  return probability;
}

export async function runPredictionChecks() {
  try {
    const models = await loadActiveModels();
    if (!models.flood && !models.landslide) return; // nothing trained yet

    const coordsList = BARANGAYS.map(({ coord }) => ({ lat: coord.lat, lon: coord.lng }));
    const [batch, dischargeBatch] = await Promise.all([
      fetchWeatherSnapshotBatch(coordsList),
      fetchRiverDischargeBatch(coordsList),
    ]);
    if (!batch) return;

    const reportsCol = mongoose.connection.db.collection("emergency_reports");
    // Tracks the highest probability seen this cycle per hazard type, purely
    // for the summary log below — makes a "model never clears threshold"
    // state visible in logs without needing an ad-hoc DB query (see the
    // calibration bug this replaced: operatingThreshold was unreachable by
    // live data for months with no visible symptom other than zero AI alerts).
    const maxProbSeen = { flood: -1, landslide: -1 };

    for (let i = 0; i < BARANGAYS.length; i++) {
      const { key, coord } = BARANGAYS[i];
      const weatherRaw = batch.data[i];
      const dischargeRaw = dischargeBatch?.data[i];

      // Hazard-agnostic — computed once per barangay per cycle, not once per
      // (barangay, hazardType), since the feature value is the same either way.
      const barangayReportRate30d = await computeBarangayReportRate(reportsCol, key, new Date(), 30);

      for (const hazardType of HAZARD_TYPES) {
        try {
          const probability = await checkBarangayHazard({
            key, coord, hazardType, model: models[hazardType], weatherRaw, dischargeRaw, barangayReportRate30d,
          });
          if (probability != null) maxProbSeen[hazardType] = Math.max(maxProbSeen[hazardType], probability);
        } catch (err) {
          console.error(`[PredictionEngine] Check failed for ${hazardType}/${key}:`, err.message);
        }
      }
    }

    for (const hazardType of HAZARD_TYPES) {
      if (maxProbSeen[hazardType] < 0) continue; // no active model for this hazard type
      const threshold = models[hazardType]?.operatingThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
      console.log(
        `[PredictionEngine] cycle summary ${hazardType}: maxProbability=${maxProbSeen[hazardType].toFixed(3)} ` +
        `threshold=${threshold.toFixed(3)}`,
      );
    }
  } catch (err) {
    console.error("[PredictionEngine] Run failed:", err.message);
  }
}
