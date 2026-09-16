// routes/alerts.js
import express from "express";
import mongoose from "mongoose";
import Alert from "../models/Alert.js";
import { protect, requireRole, optionalProtect } from "../middleware/auth.js";
import { sendAdminNotification } from "./push.js";
import { sendFCMToBarangays } from "../services/fcm.js";
import { signAlert } from "../services/alertSigning.js";
import User from "../models/user.js";
import { resolveBarangayKey, nearestBarangayKey } from "../config/barangays.js";
import { isOpsRole } from "../config/roles.js";

const NON_RESIDENT_ROLES = ["system_admin", "admin"]; // ops roles come from isOpsRole()

const router = express.Router();

// Alert.barangays is a multi-barangay array (unlike the single-key
// resourceBarangayKey shape rejectIfOutsideAssignedBarangay expects), so a
// barangay_official is allowed to act on an alert only if their assigned
// barangay is one of the alert's barangays.
function rejectIfAlertOutsideAssignedBarangay(req, res, alert) {
  if (req.user.role !== "barangay_official") return false;
  if (!alert?.barangays?.includes(req.user.assignedBarangay)) {
    res.status(403).json({ error: "Outside your assigned barangay" });
    return true;
  }
  return false;
}

// GET /api/alerts — fetch active alerts (list capped at 50, newest first),
// plus true totals across ALL matching alerts so counters don't get stuck
// at the list cap once active alerts exceed it.
// optionalProtect (not requireRole) because this is also hit anonymously —
// a barangay_official's or resident's token, when present, narrows the
// result to their own barangay + city-wide alerts; every other caller
// (no token, CDRRMO, system_admin) sees everything.
router.get("/", optionalProtect, async (req, res) => {
  try {
    const now = new Date();
    const matchQuery = {
      isActive: true,
      $and: [{ $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }],
    };

    // Their own barangay's alerts, plus city-wide ones (empty barangays
    // array = applies everywhere, e.g. a citywide CDRRMO typhoon alert).
    if (req.user?.role === "barangay_official" && req.user.assignedBarangay) {
      matchQuery.$and.push({
        $or: [{ barangays: req.user.assignedBarangay }, { barangays: { $size: 0 } }],
      });
    } else if (
      req.user &&
      !isOpsRole(req.user.role) &&
      !NON_RESIDENT_ROLES.includes(req.user.role)
    ) {
      // Anyone who isn't ops/admin is treated as a resident — DB role
      // values for citizen accounts aren't consistent ("user" vs a stray
      // "resident" seen on at least one account), so this checks by
      // exclusion instead of allowlisting one exact string.
      // Residents have no structured barangay field on their JWT (only
      // id/name/role/assignedBarangay are signed in — see auth.js's
      // signJwt), so their barangay is resolved from their profile's
      // free-text address at request time, same heuristic reports.js uses
      // for reporterBarangayKey.
      const resident = await User.findById(req.user.id).select("barangay address").lean();
      const residentBarangay = resolveBarangayKey(resident?.barangay) ?? resolveBarangayKey(resident?.address);
      if (residentBarangay) {
        matchQuery.$and.push({
          $or: [{ barangays: residentBarangay }, { barangays: { $size: 0 } }],
        });
      }
    }

    const [alerts, countsAgg] = await Promise.all([
      Alert.find(matchQuery).sort({ createdAt: -1 }).limit(50),
      Alert.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            rescue: { $sum: { $cond: [{ $eq: ["$type", "rescue"] }, 1, 0] } },
            evacuate: {
              $sum: {
                $cond: [
                  { $and: [{ $ne: ["$type", "rescue"] }, { $eq: ["$severity", "evacuate"] }] },
                  1,
                  0,
                ],
              },
            },
            critical: {
              $sum: {
                $cond: [
                  { $and: [{ $ne: ["$type", "rescue"] }, { $eq: ["$severity", "critical"] }] },
                  1,
                  0,
                ],
              },
            },
            warning: {
              $sum: {
                $cond: [
                  { $and: [{ $ne: ["$type", "rescue"] }, { $eq: ["$severity", "warning"] }] },
                  1,
                  0,
                ],
              },
            },
            watch: {
              $sum: {
                $cond: [
                  { $and: [{ $ne: ["$type", "rescue"] }, { $eq: ["$severity", "watch"] }] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    const counts = countsAgg[0]
      ? { ...countsAgg[0], _id: undefined }
      : { total: 0, rescue: 0, evacuate: 0, critical: 0, warning: 0, watch: 0 };
    delete counts._id;

    res.json({ alerts, counts, generatedAt: new Date().toISOString() });
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
router.post("/", protect, requireRole("cdrrmo", "barangay_official"), async (req, res) => {
  try {
    const { source, type, severity, title, description, location, barangays, lat, lng } = req.body;

    if (!title || !description || !severity) {
      return res.status(400).json({ error: "title, description, and severity are required" });
    }

    const isManual = true; // guaranteed by requireRole above
    const effectiveSeverity = type === "rescue" ? "evacuate" : severity;
    // Barangay officials can only ever raise alerts scoped to their own
    // barangay — ignore/override any client-supplied barangays array.
    // CDRRMO's CreateAlertModal has no barangay-picker UI — it only ever
    // sends barangays: [] — so a targeted (non-citywide) alert has to be
    // inferred from the location they pinned/typed, same resolution order
    // reports.js uses for reporterBarangayKey. An explicit non-empty
    // barangays array from the client (if a caller ever sends one) still
    // wins over the inferred guess.
    const inferredBarangayKey = resolveBarangayKey(location) ?? nearestBarangayKey(lat, lng);
    const effectiveBarangays =
      req.user.role === "barangay_official"
        ? [req.user.assignedBarangay]
        : Array.isArray(barangays) && barangays.length > 0
          ? barangays
          : inferredBarangayKey
            ? [inferredBarangayKey]
            : [];

    // _id is pre-generated (rather than left to Alert.create) because the
    // signature is computed over the alert's id along with its other
    // fields — signing has to happen before/at insert, not after, so the
    // very first version of the document that ever exists is already the
    // signed one.
    const alertFields = {
      _id: new mongoose.Types.ObjectId(),
      source:   source ?? "CDRRMO",
      type:     type ?? "other",
      severity: effectiveSeverity,
      title,
      description,
      location: location ?? "Antipolo City, Rizal",
      barangays: effectiveBarangays,
      lat:      lat ?? null,
      lng:      lng ?? null,
      isManual,
      isActive: true,
      createdAt: new Date(),
      // Manual alerts never expire — they must be dismissed/resolved manually
      ...(isManual ? {} : { expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000) }),
      actionLog: [{ action: "created", by: req.user.name ?? req.user.email ?? "admin" }],
    };
    const signed = signAlert(alertFields);

    const alert = await Alert.create({
      ...alertFields,
      ...(signed ? { signature: signed.signature, keyId: signed.keyId } : {}),
    });

    // Emit socket + push notification to all subscribers
    const io = req.app.get("io");
    io?.emit("new_alert", alert.toObject());

    const isRescue = type === "rescue";
    const pushPayload = {
      title: isRescue ? "🚨 Rescue Alert" : `⚠️ ${title}`,
      body:  description,
      url:   "/alerts",
      tag:   `alert-${alert._id}`,
      urgent: isRescue,
    };
    // Both ops (web/VAPID) and resident (mobile/FCM) channels are scoped to
    // the alert's barangays — a barangay_official or resident outside the
    // alert's barangays doesn't get pushed a notification for it. CDRRMO
    // always gets everything; an empty barangays array (citywide alert)
    // falls back to notifying everyone on both channels.
    sendAdminNotification(pushPayload, effectiveBarangays)
      .catch((err) => console.error("[Push] sendAdminNotification failed:", err));
    sendFCMToBarangays(pushPayload, effectiveBarangays)
      .catch((err) => console.error("[Push] sendFCMToBarangays failed:", err));

    if (isManual) {
      const db = mongoose.connection.db;
      const severityMap = { evacuate: "high", warning: "medium", watch: "low" };
      // A report has a single barangay key but an alert can target several
      // (or none, for citywide) — only the single-barangay case maps
      // unambiguously onto scopeToAssignedBarangay's equality match. Leave
      // it null for citywide/multi-barangay alerts (CDRRMO-only visibility
      // on the Reports page, same conservative fallback used elsewhere for
      // reports with no resolvable barangay) rather than guess which one
      // barangay_official should see it.
      const linkedBarangayKey = effectiveBarangays.length === 1 ? effectiveBarangays[0] : null;
      const reportDoc = {
        emergencyType: type ?? "other",
        severity:      severityMap[effectiveSeverity] ?? "medium",
        description,
        location:  { exactAddress: location ?? "Antipolo City, Rizal" },
        latitude:  lat ?? null,
        longitude: lng ?? null,
        userName:  source ?? "CDRRMO",
        timestamp: new Date(),
        status:    "approved",
        isAlertLinked: true,
        linkedAlertId: alert._id,
        barangayKey: linkedBarangayKey,
        reporterBarangayKey: linkedBarangayKey,
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
router.patch("/:id/dismiss", protect, requireRole("cdrrmo", "barangay_official"), async (req, res) => {
  try {
    const existing = await Alert.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Alert not found" });
    if (rejectIfAlertOutsideAssignedBarangay(req, res, existing)) return;

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
router.patch("/:id/resolve", protect, requireRole("cdrrmo", "barangay_official"), async (req, res) => {
  try {
    const existing = await Alert.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Alert not found" });
    if (rejectIfAlertOutsideAssignedBarangay(req, res, existing)) return;

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
router.patch("/:id/confirm", protect, requireRole("cdrrmo", "barangay_official"), async (req, res) => {
  try {
    const existing = await Alert.findOne({ _id: req.params.id, source: "ai" });
    if (!existing) return res.status(404).json({ error: "AI alert not found" });
    if (rejectIfAlertOutsideAssignedBarangay(req, res, existing)) return;

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
router.patch("/:id/reject", protect, requireRole("cdrrmo", "barangay_official"), async (req, res) => {
  try {
    const existing = await Alert.findOne({ _id: req.params.id, source: "ai" });
    if (!existing) return res.status(404).json({ error: "AI alert not found" });
    if (rejectIfAlertOutsideAssignedBarangay(req, res, existing)) return;

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

// PATCH /api/alerts/:id/reactivate — restore a dismissed alert (CDRRMO / assigned Barangay Official)
router.patch("/:id/reactivate", protect, requireRole("cdrrmo", "barangay_official"), async (req, res) => {
  try {
    const existing = await Alert.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Alert not found" });
    if (rejectIfAlertOutsideAssignedBarangay(req, res, existing)) return;

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
