// routes/alerts.js
import express from "express";
import mongoose from "mongoose";
import Alert from "../models/Alert.js";
import { protect } from "../middleware/auth.js";
import { sendNotificationToAll } from "./push.js";
import { BARANGAY_KEYS, resolveBarangayKey } from "../config/barangays.js";

const router = express.Router();

// GET /api/alerts — fetch all active alerts, sorted by severity then time
router.get("/", async (req, res) => {
  try {
    const now = new Date();
    const alerts = await Alert.find({
      isActive: true,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ alerts, generatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch alerts" });
  }
});

// GET /api/alerts/log — all actionLog entries across alerts, newest first
router.get("/log", async (req, res) => {
  try {
    const alerts = await Alert.find({ "actionLog.0": { $exists: true } })
      .select("title actionLog")
      .lean();

    const entries = [];
    for (const alert of alerts) {
      for (const entry of alert.actionLog) {
        entries.push({
          _id: entry._id,
          alertId: alert._id,
          alertTitle: alert.title,
          action: entry.action,
          by: entry.by,
          at: entry.at,
        });
      }
    }

    entries.sort((a, b) => new Date(b.at) - new Date(a.at));
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch alert log" });
  }
});

// POST /api/alerts — create a manual alert (also auto-creates a linked report)
router.post("/", protect, async (req, res) => {
  try {
    const { source, type, severity, title, description, location, barangays, lat, lng } = req.body;

    if (!title || !description || !severity) {
      return res.status(400).json({ error: "title, description, and severity are required" });
    }

    const isManual = ["admin", "barangay_official"].includes(req.user.role);
    const effectiveSeverity = type === "rescue" ? "evacuate" : severity;

    const alert = await Alert.create({
      source:   source ?? "CDRRMO",
      type:     type ?? "other",
      severity: effectiveSeverity,
      title,
      description,
      location: location ?? "Antipolo City, Rizal",
      barangays: barangays ?? [],
      lat:      lat ?? null,
      lng:      lng ?? null,
      isManual,
      isActive: true,
      // Manual alerts never expire — they must be dismissed/resolved manually
      ...(isManual ? {} : { expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000) }),
      actionLog: [{ action: "created", by: req.user.name ?? req.user.email ?? "admin" }],
    });

    // Emit socket + push notification to all subscribers
    const io = req.app.get("io");
    io?.emit("new_alert", alert.toObject());

    const isRescue = type === "rescue";
    sendNotificationToAll({
      title: isRescue ? "🚨 Rescue Alert" : `⚠️ ${title}`,
      body:  description,
      url:   "/alerts",
      tag:   `alert-${alert._id}`,
      urgent: isRescue,
    }).catch((err) => console.error("[Push] sendNotificationToAll failed:", err));

    if (isManual) {
      const db = mongoose.connection.db;
      const severityMap = { evacuate: "high", warning: "medium", watch: "low" };
      // Canonical barangay for scoping (server/middleware/auth.js): prefer an
      // explicit barangays[] entry, fall back to parsing the location string,
      // then to the creating official's own assignment.
      const barangayKey =
        (Array.isArray(barangays) && barangays.find((b) => BARANGAY_KEYS.includes(b))) ??
        resolveBarangayKey(location) ??
        (req.user.role === "barangay_official" ? req.user.assignedBarangay : null) ??
        null;
      const reportDoc = {
        emergencyType: type ?? "other",
        severity:      severityMap[effectiveSeverity] ?? "medium",
        description,
        location:  { exactAddress: location ?? "Antipolo City, Rizal" },
        latitude:  lat ?? null,
        longitude: lng ?? null,
        barangayKey,
        userName:  source ?? "CDRRMO",
        timestamp: new Date(),
        status:    "approved",
        isAlertLinked: true,
        linkedAlertId: alert._id,
        images: [],
        logs: [{
          action: "approved",
          by:     req.user.name ?? req.user.email ?? "admin",
          at:     new Date().toISOString(),
          notes:  "Auto-approved from manual alert creation",
        }],
      };

      const result = await db.collection("emergency_reports").insertOne(reportDoc);
      await Alert.findByIdAndUpdate(alert._id, { linkedReportId: result.insertedId });

      const io = req.app.get("io");
      if (io) {
        io.emit("new_emergency_report", { _id: result.insertedId, ...reportDoc });
        io.emit("report_status_updated", {
          reportId: result.insertedId.toString(),
          status: "approved",
          report: { _id: result.insertedId, ...reportDoc },
        });
      }
    }

    res.status(201).json({ success: true, alert });
  } catch (err) {
    console.error("❌ Create alert:", err.message);
    res.status(500).json({ error: "Failed to create alert" });
  }
});

// PATCH /api/alerts/:id/dismiss — soft-delete an alert + resolve its linked report
router.patch("/:id/dismiss", protect, async (req, res) => {
  try {
    const actorName = req.user.name ?? req.user.email ?? "admin";
    const alert = await Alert.findByIdAndUpdate(
      req.params.id,
      {
        isActive: false,
        updatedAt: new Date(),
        $push: { actionLog: { action: "dismissed", by: actorName } },
      },
      { new: true },
    );

    const io = req.app.get("io");
    if (io) {
      io.emit("alert_updated", { id: req.params.id, isActive: false });
    }

    if (alert?.linkedReportId) {
      await mongoose.connection.db.collection("emergency_reports").updateOne(
        { _id: alert.linkedReportId },
        {
          $set: {
            status:           "resolved",
            resolvedBy:       actorName,
            resolvedAt:       new Date().toISOString(),
            resolutionNotes:  "Alert was dismissed",
          },
          $push: {
            logs: {
              action: "resolved",
              by:     actorName,
              at:     new Date().toISOString(),
              notes:  "Alert was dismissed",
            },
          },
        },
      );
      if (io) {
        io.emit("report_updated",        { reportId: alert.linkedReportId.toString(), status: "resolved" });
        io.emit("report_status_updated", { reportId: alert.linkedReportId.toString(), status: "resolved" });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Dismiss alert:", err.message);
    res.status(500).json({ error: "Failed to dismiss alert" });
  }
});

// PATCH /api/alerts/:id/resolve — mark alert resolved + resolve linked report
router.patch("/:id/resolve", protect, async (req, res) => {
  try {
    const actorName = req.user.name ?? req.user.email ?? "admin";
    const alert = await Alert.findByIdAndUpdate(
      req.params.id,
      {
        isActive: false,
        updatedAt: new Date(),
        $push: { actionLog: { action: "resolved", by: actorName } },
      },
      { new: true },
    );

    const io = req.app.get("io");
    if (io) {
      io.emit("alert_updated", { id: req.params.id, isActive: false });
    }

    if (alert?.linkedReportId) {
      await mongoose.connection.db.collection("emergency_reports").updateOne(
        { _id: alert.linkedReportId },
        {
          $set: {
            status:          "resolved",
            resolvedBy:      actorName,
            resolvedAt:      new Date().toISOString(),
            resolutionNotes: req.body.notes ?? "Alert resolved",
          },
          $push: {
            logs: {
              action: "resolved",
              by:     actorName,
              at:     new Date().toISOString(),
              notes:  req.body.notes ?? "Alert resolved",
            },
          },
        },
      );
      if (io) {
        io.emit("report_updated",        { reportId: alert.linkedReportId.toString(), status: "resolved" });
        io.emit("report_status_updated", { reportId: alert.linkedReportId.toString(), status: "resolved" });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Resolve alert:", err.message);
    res.status(500).json({ error: "Failed to resolve alert" });
  }
});

// PATCH /api/alerts/:id/confirm — admin confirms an AI-predicted hazard actually
// occurred. Scoped to source:"ai" alerts only — this is the feedback signal
// scripts/trainRiskModel.js reads back as fieldMetrics on the next retrain.
router.patch("/:id/confirm", protect, async (req, res) => {
  try {
    const actorName = req.user.name ?? req.user.email ?? "admin";
    const alert = await Alert.findOneAndUpdate(
      { _id: req.params.id, source: "ai" },
      {
        confirmedOutcome: "true_positive",
        confirmedBy: actorName,
        confirmedAt: new Date(),
        updatedAt: new Date(),
        $push: { actionLog: { action: "resolved", by: actorName } },
      },
      { new: true },
    );
    if (!alert) return res.status(404).json({ error: "AI alert not found" });

    req.app.get("io")?.emit("alert_updated", { id: req.params.id, confirmedOutcome: "true_positive" });
    res.json({ ok: true, alert });
  } catch (err) {
    console.error("❌ Confirm AI alert:", err.message);
    res.status(500).json({ error: "Failed to confirm alert" });
  }
});

// PATCH /api/alerts/:id/reject — admin marks an AI-predicted hazard a false positive.
router.patch("/:id/reject", protect, async (req, res) => {
  try {
    const actorName = req.user.name ?? req.user.email ?? "admin";
    const alert = await Alert.findOneAndUpdate(
      { _id: req.params.id, source: "ai" },
      {
        confirmedOutcome: "false_positive",
        confirmedBy: actorName,
        confirmedAt: new Date(),
        updatedAt: new Date(),
        $push: { actionLog: { action: "dismissed", by: actorName } },
      },
      { new: true },
    );
    if (!alert) return res.status(404).json({ error: "AI alert not found" });

    req.app.get("io")?.emit("alert_updated", { id: req.params.id, confirmedOutcome: "false_positive" });
    res.json({ ok: true, alert });
  } catch (err) {
    console.error("❌ Reject AI alert:", err.message);
    res.status(500).json({ error: "Failed to reject alert" });
  }
});

// PATCH /api/alerts/:id/reactivate — restore a dismissed alert (admin only)
router.patch("/:id/reactivate", protect, async (req, res) => {
  try {
    const actorName = req.user.name ?? req.user.email ?? "admin";
    const alert = await Alert.findByIdAndUpdate(
      req.params.id,
      {
        isActive: true,
        updatedAt: new Date(),
        $push: { actionLog: { action: "created", by: actorName } },
      },
      { new: true },
    );
    if (!alert) return res.status(404).json({ error: "Alert not found" });

    const io = req.app.get("io");
    if (io) io.emit("alert_updated", { id: req.params.id, isActive: true });

    res.json({ ok: true, alert });
  } catch (err) {
    console.error("❌ Reactivate alert:", err.message);
    res.status(500).json({ error: "Failed to reactivate alert" });
  }
});

export default router;
