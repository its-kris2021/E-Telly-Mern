// routes/adminMetrics.js
//
// Serves the risk model's version history + confusion-matrix-style counts of
// confirmed AI-prediction outcomes — the artifact for showing the model
// actually improving (or honestly, calibrating) as more report data
// accumulates. Consumed by client/src/components/admin/ModelPerformancePanel.jsx.
import express from "express";
import RiskModel from "../models/RiskModel.js";
import Alert from "../models/Alert.js";
import { protect, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/model-metrics", protect, requireRole("system_admin", "cdrrmo", "barangay_official"), async (req, res) => {
  try {
    const [floodVersions, landslideVersions] = await Promise.all([
      RiskModel.find({ hazardType: "flood" }).sort({ version: -1 }).limit(20).lean(),
      RiskModel.find({ hazardType: "landslide" }).sort({ version: -1 }).limit(20).lean(),
    ]);

    // Live confusion-matrix counts across ALL AI alerts ever created (not just
    // the active model version's — RiskModel.fieldMetrics is a point-in-time
    // snapshot taken at each retrain, this is the current running total).
    const outcomeCounts = async (hazardType) => {
      const [truePositives, falsePositives, unconfirmed, expiredUnconfirmed] = await Promise.all([
        Alert.countDocuments({ source: "ai", type: hazardType, confirmedOutcome: "true_positive" }),
        Alert.countDocuments({ source: "ai", type: hazardType, confirmedOutcome: "false_positive" }),
        Alert.countDocuments({ source: "ai", type: hazardType, confirmedOutcome: "unconfirmed" }),
        // Expired with no admin review and no matching report — NOT a
        // verified false positive, kept separate so it can't be mistaken
        // for one (see models/Alert.js confirmedOutcome comment).
        Alert.countDocuments({ source: "ai", type: hazardType, confirmedOutcome: "expired_unconfirmed" }),
      ]);
      return { truePositives, falsePositives, unconfirmed, expiredUnconfirmed };
    };

    const [floodOutcomes, landslideOutcomes] = await Promise.all([
      outcomeCounts("flood"),
      outcomeCounts("landslide"),
    ]);

    res.json({
      flood: { versions: floodVersions, currentOutcomes: floodOutcomes },
      landslide: { versions: landslideVersions, currentOutcomes: landslideOutcomes },
    });
  } catch (err) {
    console.error("❌ Model metrics:", err.message);
    res.status(500).json({ error: "Failed to fetch model metrics" });
  }
});

export default router;
