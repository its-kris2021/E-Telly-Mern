import express from "express";
import mongoose from "mongoose";
import messageReportRoutes from "../../routes/messageReports.js";
import chatModerationRoutes from "../../routes/chatModeration.js";
import chatRestrictionRoutes from "../../routes/chatRestriction.js";
import auditLogRoutes from "../../routes/auditLogs.js";
import { protect, requireRole, requireAssignedBarangayIfOfficial, scopeToAssignedBarangay } from "../../middleware/auth.js";

// Deliberately does not import server/index.js — that file connects to the
// real MongoDB Atlas cluster and boots Socket.IO as a top-level side effect
// at import time, neither of which belongs in a test process. This mounts
// only the routes under test against whatever the shared mongoose connection
// is at request time (pointed at the in-memory DB by testDb.js).
export function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/message-reports", messageReportRoutes);
  app.use("/api/chat-monitoring", chatModerationRoutes);
  app.use("/api/chat-restriction", chatRestrictionRoutes);
  app.use("/api/audit-logs", auditLogRoutes);

  // Mirrors server/index.js's "GET /api/reports" handler verbatim (can't
  // import index.js itself here — see above). Kept in sync manually; if the
  // real handler changes, update this too.
  app.get("/api/reports", protect, requireRole("system_admin", "cdrrmo", "barangay_official"), requireAssignedBarangayIfOfficial, async (req, res) => {
    try {
      const reports = await mongoose.connection.db
        .collection("emergency_reports")
        .find(scopeToAssignedBarangay(req, "reporterBarangayKey"))
        .sort({ timestamp: -1 })
        .toArray();
      res.json({ success: true, reports });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return app;
}
