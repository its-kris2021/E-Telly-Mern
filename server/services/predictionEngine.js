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
import { fetchWeatherSnapshotBatch } from "./openMeteoCache.js";
import { extractSnapshotFeatures } from "./weatherSnapshotService.js";
import { computeBarangayReportRate, susceptibilityFeature, toFeatureVector } from "./riskFeatures.js";
import { applyStandardization, predictProba } from "./logisticRegression.js";
import { toDateKey, upsertAiAlert } from "./alertHelpers.js";

const HAZARD_TYPES = ["flood", "landslide"];
const CONFIDENCE_THRESHOLD = 0.6;
const SEVERITY_RANK = { watch: 1, warning: 2, critical: 3, evacuate: 4 };

const BARANGAYS = Object.entries(BARANGAY_COORDS).map(([key, coord]) => ({ key, coord }));

async function loadActiveModels() {
  const models = {};
  for (const hazardType of HAZARD_TYPES) {
    models[hazardType] = await RiskModel.findOne({ hazardType, isActive: true }).lean();
  }
  return models;
}

function severityFromProbability(prob) {
  if (prob >= 0.85) return "critical";
  if (prob >= 0.7)  return "warning";
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

async function checkBarangayHazard({ key, coord, hazardType, model, weatherRaw, barangayReportRate30d }) {
  if (!model) return;

  const named = {
    ...extractSnapshotFeatures(weatherRaw),
    barangayReportRate30d,
    susceptibility: susceptibilityFeature(key),
  };
  const vector = toFeatureVector(named);
  const standardized = applyStandardization(vector, model.featureMeans, model.featureStds);
  const probability = predictProba(standardized, model.weights, model.bias);

  if (probability < CONFIDENCE_THRESHOLD) return;

  const severity = severityFromProbability(probability);
  if (await ruleEngineAlreadyCovers(key, hazardType, SEVERITY_RANK[severity])) return;

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
    expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
  });

  console.log(`[PredictionEngine] ${hazardType}/${key} — probability=${probability.toFixed(2)} severity=${severity}`);
}

export async function runPredictionChecks() {
  try {
    const models = await loadActiveModels();
    if (!models.flood && !models.landslide) return; // nothing trained yet

    const coordsList = BARANGAYS.map(({ coord }) => ({ lat: coord.lat, lon: coord.lng }));
    const batch = await fetchWeatherSnapshotBatch(coordsList);
    if (!batch) return;

    const reportsCol = mongoose.connection.db.collection("emergency_reports");

    for (let i = 0; i < BARANGAYS.length; i++) {
      const { key, coord } = BARANGAYS[i];
      const weatherRaw = batch.data[i];

      // Hazard-agnostic — computed once per barangay per cycle, not once per
      // (barangay, hazardType), since the feature value is the same either way.
      const barangayReportRate30d = await computeBarangayReportRate(reportsCol, key, new Date(), 30);

      for (const hazardType of HAZARD_TYPES) {
        try {
          await checkBarangayHazard({
            key, coord, hazardType, model: models[hazardType], weatherRaw, barangayReportRate30d,
          });
        } catch (err) {
          console.error(`[PredictionEngine] Check failed for ${hazardType}/${key}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error("[PredictionEngine] Run failed:", err.message);
  }
}
