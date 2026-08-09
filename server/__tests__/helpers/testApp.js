import express from "express";
import messageReportRoutes from "../../routes/messageReports.js";
import chatModerationRoutes from "../../routes/chatModeration.js";
import auditLogRoutes from "../../routes/auditLogs.js";

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
  app.use("/api/audit-logs", auditLogRoutes);
  return app;
}
