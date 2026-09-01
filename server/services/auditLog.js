// services/auditLog.js
import AuditLog from "../models/AuditLog.js";

// Fire-and-forget audit write — callers await it (so ordering/tests are
// predictable) but a logging failure must never fail the request it's
// describing, so errors are swallowed here rather than propagated.
export async function recordAuditLog({ domain, action, actorId, actorName, actorRole, notes = "", target = null }) {
  try {
    await AuditLog.create({ domain, action, actorId, actorName, actorRole, notes, target });
  } catch (err) {
    console.error("[AuditLog] write failed:", err.message);
  }
}
