import express from "express";
import mongoose from "mongoose";
import { sendAdminNotification } from "./push.js";
import { BARANGAY_COORDS, resolveBarangayKey, nearestBarangayKey } from "../config/barangays.js";
import { fetchWeatherSnapshot } from "../services/openMeteoCache.js";
import { extractSnapshotFeatures } from "../services/weatherSnapshotService.js";
import Alert from "../models/Alert.js";

const router = express.Router();

// Best-effort: attaches a weatherSnapshot (rainfall + soil moisture at the time
// of submission) to a report so it can later be used as a labeled training
// example for the risk model (see services/weatherSnapshotService.js for the
// shared feature definitions). Runs after the response is already sent — must
// never add latency or a new failure mode to report submission.
async function attachWeatherSnapshot(reportId, { barangay, location, latitude, longitude }) {
  try {
    const freeTextBarangay = barangay || location?.barangay || "";
    const lat = typeof latitude === "number" ? latitude : location?.coordinates?.latitude;
    const lng = typeof longitude === "number" ? longitude : location?.coordinates?.longitude;

    const barangayKey =
      resolveBarangayKey(freeTextBarangay) ?? nearestBarangayKey(lat, lng);
    if (!barangayKey) return; // no usable location — skip, don't fail the report

    const coord = BARANGAY_COORDS[barangayKey];
    const result = await fetchWeatherSnapshot(coord.lat, coord.lng);
    if (!result) return;

    const weatherSnapshot = {
      barangay: barangayKey,
      ...extractSnapshotFeatures(result.data),
      capturedAt: new Date(),
    };

    await mongoose.connection.db
      .collection("emergency_reports")
      .updateOne({ _id: reportId }, { $set: { weatherSnapshot } });
  } catch (err) {
    console.error("[Reports] Weather snapshot attach failed:", err.message);
  }
}

// Auto weak-label: a real report matching an unconfirmed AI-predicted alert
// (same hazard type + barangay) is strong evidence the prediction was right.
// This is what lets fieldMetrics (scripts/trainRiskModel.js) accumulate
// without relying purely on an admin remembering to click "Confirm".
async function autoConfirmMatchingAiAlert({ emergencyType, barangay, location, latitude, longitude }) {
  try {
    const freeTextBarangay = barangay || location?.barangay || "";
    const lat = typeof latitude === "number" ? latitude : location?.coordinates?.latitude;
    const lng = typeof longitude === "number" ? longitude : location?.coordinates?.longitude;
    const barangayKey = resolveBarangayKey(freeTextBarangay) ?? nearestBarangayKey(lat, lng);
    if (!barangayKey) return;

    await Alert.updateOne(
      {
        source: "ai",
        type: emergencyType,
        barangays: barangayKey,
        confirmedOutcome: "unconfirmed",
        isActive: true,
      },
      {
        $set: {
          confirmedOutcome: "true_positive",
          confirmedBy: "auto:linked_report",
          confirmedAt: new Date(),
        },
      },
    );
  } catch (err) {
    console.error("[Reports] Auto-confirm AI alert failed:", err.message);
  }
}

// GET /api/reports/approved - Get approved reports
router.get("/approved", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(500).json({
        success: false,
        error: "Database not connected",
      });
    }

    const db = mongoose.connection.db;
    const reportsCollection = db.collection("emergency_reports");

    const { emergencyType, limit = 100 } = req.query;

    // Build query. Excludes historical bulk-import rows (see
    // scripts/importHistoricalReports.js) — those exist only as training
    // labels for the risk model, not live incidents, and must never render
    // on the map as if a years-old report just happened.
    const query = { status: "approved", importSource: { $ne: "historical_excel_import" } };

    // Filter by emergency type if specified. Validated against an allowlist
    // (rather than assigned as-is) so a crafted query-string object like
    // ?emergencyType[$ne]=null can't be passed straight through as a Mongo
    // operator — req.query parsing turns bracket syntax into nested objects.
    const VALID_TYPES = ["fire", "flood", "rainfall", "earthquake", "lahar", "typhoon", "storm", "landslide", "rescue", "other"];
    if (emergencyType && emergencyType !== "all") {
      if (typeof emergencyType !== "string" || !VALID_TYPES.includes(emergencyType)) {
        return res.status(400).json({ success: false, error: "Invalid emergencyType" });
      }
      query.emergencyType = emergencyType;
    }

    const reports = await reportsCollection
      .find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .toArray();

    // Transform for frontend
    const formattedReports = reports.map((report) => ({
      _id: report._id,
      emergencyType: report.emergencyType,
      severity: report.severity,
      description: report.description || "",
      location: report.location || {},
      latitude: report.latitude,
      longitude: report.longitude,
      timestamp: report.timestamp,
      images: report.images || [],
      status: report.status,
      userData: {
        fullName: report.userName || "Anonymous",
        phone: report.phoneNumber || null,
      },
    }));

    res.json({
      success: true,
      reports: formattedReports,
      count: formattedReports.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch reports",
      details: error.message,
    });
  }
});

// POST /api/reports/create - Create new report
router.post("/create", async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const reportsCollection = db.collection("emergency_reports");

    const {
      emergencyType, severity, description, location,
      latitude, longitude, userName, phoneNumber, images, barangay,
      source, offlineSubmittedAt, reportId, userData,
    } = req.body;

    if (!emergencyType || !severity) {
      return res.status(400).json({ success: false, error: "Missing required fields: emergencyType, severity" });
    }

    // Incident location, for the map only — GPS/free-text, never used to
    // decide who gets to see the report.
    const freeTextBarangay = barangay || location?.barangay || "";
    const lat = typeof latitude === "number" ? latitude : location?.coordinates?.latitude;
    const lng = typeof longitude === "number" ? longitude : location?.coordinates?.longitude;
    const barangayKey = resolveBarangayKey(freeTextBarangay) ?? nearestBarangayKey(lat, lng);

    // Reporter's registered profile barangay — the source of truth for
    // barangay_official routing/visibility (see scopeToAssignedBarangay in
    // middleware/auth.js). The mobile app writes a structured `barangay`
    // field (e.g. "Bagong Nayon") directly to the users collection outside
    // this schema's declared paths, which is the reliable source; free-text
    // `address` is only a fallback for accounts that predate it.
    // A report from an unregistered/unmatched reporter gets reporterBarangayKey:
    // null and simply won't surface for any barangay_official — only CDRRMO
    // (unscoped) still sees it.
    const reporterEmail = (userData?.email || "").trim().toLowerCase();
    const reporter = reporterEmail
      ? await mongoose.connection.db.collection("users").findOne(
          { email: reporterEmail },
          { projection: { barangay: 1, address: 1 } },
        )
      : null;
    const reporterBarangayKey = reporter
      ? resolveBarangayKey(reporter.barangay) ?? resolveBarangayKey(reporter.address)
      : null;

    const reportData = {
      emergencyType, severity, description, location,
      latitude, longitude, userName, phoneNumber,
      images: Array.isArray(images) ? images.filter((s) => typeof s === "string" && s.startsWith("http")) : [],
      barangay: barangay || "",
      barangayKey: barangayKey || null,
      reporterEmail: reporterEmail || null,
      reporterBarangayKey,
      timestamp: new Date(),
      status: "pending",
      source: source || "online",
      offlineSubmittedAt: offlineSubmittedAt ? new Date(offlineSubmittedAt) : null,
      syncedToCloud: process.env.LOCAL_MODE === 'true' ? false : true,
      ...(reportId && { reportId }),
    };

    const result = await reportsCollection.insertOne(reportData);

    // Emit socket event
    const io = req.app.get("io");
    if (io) {
      io.emit("new_emergency_report", {
        _id: result.insertedId,
        ...reportData,
      });
    }

    // Push notification — works even on standalone local MongoDB (no change stream needed)
    const locationLabel =
      (typeof location === "string" ? location : location?.barangay || location?.address || "") ||
      barangay ||
      "Unknown location";
    const severityLabel = severity ? ` (${severity})` : "";
    sendAdminNotification({
      title: `New Report: ${emergencyType || "Emergency"}${severityLabel}`,
      body: `A new pending report was submitted from ${locationLabel}. Tap to review.`,
      url: "/reports",
      tag: `report-${result.insertedId}`,
      urgent: true,
    }).catch((err) => console.error("[Push] Report notification failed:", err));

    res.json({
      success: true,
      reportId: result.insertedId,
      message: "Report created successfully",
    });

    // Fire-and-forget — response already sent, must not block/fail submission.
    attachWeatherSnapshot(result.insertedId, { barangay, location, latitude, longitude });
    autoConfirmMatchingAiAlert({ emergencyType, barangay, location, latitude, longitude });
  } catch (error) {
    console.error("Error creating report:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create report",
    });
  }
});

// Export as default for ES modules
export default router;
