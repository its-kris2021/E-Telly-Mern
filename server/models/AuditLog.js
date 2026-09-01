// models/AuditLog.js
//
// Standalone audit trail for events that have no natural host document to
// embed a log array in (a login isn't "owned" by any one record, and a
// deleted user would take its own history with it). Every other audit
// domain (chat moderation, alerts, evacuation, emergency reports) logs by
// embedding entries on the relevant document instead — see
// routes/auditLogs.js for how both styles are merged into one feed.
import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema({
  domain: { type: String, enum: ["login", "user_management"], required: true },
  action: { type: String, required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  actorName: { type: String, required: true },
  actorRole: { type: String, default: null },
  notes: { type: String, default: "" },
  target: {
    type: { type: String, default: null },
    id: { type: String, default: null },
    label: { type: String, default: null },
  },
  at: { type: Date, default: Date.now },
});

export default mongoose.model("AuditLog", auditLogSchema);
