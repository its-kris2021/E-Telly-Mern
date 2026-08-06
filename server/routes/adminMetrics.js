// routes/adminMetrics.js
//
// Serves the risk model's version history + confusion-matrix-style counts of
// confirmed AI-prediction outcomes — the artifact for showing the model
// actually improving (or honestly, calibrating) as more report data
// accumulates. Consumed by client/src/components/admin/ModelPerformancePanel.jsx.
import express from "express";
import RiskModel from "../models/RiskModel.js";
import Alert from "../models/Alert.js";
import { protect, requireAdminOrBarangay } from "../middleware/auth.js";

const router = express.Router();

router.get("/model-metrics", protect, requireAdminOrBarangay, async (req, res) => {
  try {
    const [floodVersions, landslideVersions] = await Promise.all([
      RiskModel.find({ hazardType: "flood" }).sort({ version: -1 }).limit(20).lean(),
      RiskModel.find({ hazardType: "landslide" }).sort({ version: -1 }).limit(20).lean(),
    ]);

    // Live confusion-matrix counts across ALL AI alerts ever created (not just
    // the active model version's — RiskModel.fieldMetrics is a point-in-time
    // snapshot taken at each retrain, this is the current running total).
    const outcomeCounts = async (hazardType) => {
      const [truePositives, falsePositives, unconfirmed] = await Promise.all([
        Alert.countDocuments({ source: "ai", type: hazardType, confirmedOutcome: "true_positive" }),
        Alert.countDocuments({ source: "ai", type: hazardType, confirmedOutcome: "false_positive" }),
        Alert.countDocuments({ source: "ai", type: hazardType, confirmedOutcome: "unconfirmed" }),
      ]);
      return { truePositives, falsePositives, unconfirmed };
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
