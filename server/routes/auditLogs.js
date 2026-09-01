import express from "express";
import mongoose from "mongoose";
import { protect, requireRole } from "../middleware/auth.js";
import ChatModerationCase from "../models/ChatModerationCase.js";
import ChatUserModerationProfile from "../models/ChatUserModerationProfile.js";
import Alert from "../models/Alert.js";
import EvacuationLog from "../models/EvacuationLog.js";
import AuditLog from "../models/AuditLog.js";

const router = express.Router();

// The API's ?domain= filter groups the two chat-moderation sub-domains
// (per-message cases and per-user warning/restriction history) under one
// "chat" value — they're one feature from the UI's perspective — while
// entries still carry their granular domain ("chat_case"/"chat_user") for
// display. Everything else is 1:1.
const DOMAIN_FILTERS = {
  chat: (e) => e.domain === "chat_case" || e.domain === "chat_user",
  emergency_report: (e) => e.domain === "emergency_report",
  alert: (e) => e.domain === "alert",
  evacuation: (e) => e.domain === "evacuation",
  login: (e) => e.domain === "login",
  user_management: (e) => e.domain === "user_management",
};

// Per-source scan cap — mirrors the existing lightweight "scan bounded recent
// docs, flatten embedded logs, sort/merge in memory" pattern already used by
// GET /api/alerts/log. Fine for this app's current volume; a dedicated
// unified log collection would be the more scalable design if that changes.
const SOURCE_LIMIT = 300;

async function collectChatCaseEntries() {
  const cases = await ChatModerationCase.find({ "logs.0": { $exists: true } })
    .populate("reportedUserId", "name")
    .select("logs reportedUserId messageId")
    .sort({ lastReportedAt: -1 })
    .limit(SOURCE_LIMIT)
    .lean();

  const entries = [];
  for (const c of cases) {
    const reportedName = c.reportedUserId?.name || "Unknown user";
    for (const log of c.logs || []) {
      entries.push({
        domain: "chat_case",
        action: log.action,
        actorName: log.byName,
        actorRole: log.byRole || null,
        at: log.at,
        notes: log.notes || "",
        target: { type: "chat_case", id: String(c._id), label: `Reported message — ${reportedName}` },
      });
    }
  }
  return entries;
}

async function collectChatUserEntries() {
  const profiles = await ChatUserModerationProfile.find({ "history.0": { $exists: true } })
    .populate("userId", "name")
    .select("history userId")
    .limit(SOURCE_LIMIT)
    .lean();

  const entries = [];
  for (const p of profiles) {
    const userName = p.userId?.name || "Unknown user";
    for (const h of p.history || []) {
      entries.push({
        domain: "chat_user",
        action: h.action,
        actorName: h.byName,
        actorRole: h.byRole || null,
        at: h.at,
        notes: h.note || "",
        target: { type: "chat_user", id: p.userId ? String(p.userId._id ?? p.userId) : null, label: userName },
      });
    }
  }
  return entries;
}

async function collectEmergencyReportEntries() {
  const reports = await mongoose.connection.db
    .collection("emergency_reports")
    .find({ "logs.0": { $exists: true } })
    .project({ logs: 1, emergencyType: 1 })
    .sort({ timestamp: -1 })
    .limit(SOURCE_LIMIT)
    .toArray();

  const entries = [];
  for (const r of reports) {
    const label = r.emergencyType
      ? r.emergencyType.charAt(0).toUpperCase() + r.emergencyType.slice(1) + " report"
      : "Emergency report";
    for (const log of r.logs || []) {
      entries.push({
        domain: "emergency_report",
        action: log.action,
        actorName: log.by,
        actorRole: null,
        at: log.at,
        notes: log.notes || "",
        target: { type: "emergency_report", id: String(r._id), label },
      });
    }
  }
  return entries;
}

async function collectAlertEntries() {
  const alerts = await Alert.find({ "actionLog.0": { $exists: true } })
    .select("title actionLog")
    .sort({ createdAt: -1 })
    .limit(SOURCE_LIMIT)
    .lean();

  const entries = [];
  for (const a of alerts) {
    for (const log of a.actionLog || []) {
      entries.push({
        domain: "alert",
        action: log.action,
        actorName: log.by,
        actorRole: null,
        at: log.at,
        notes: "",
        target: { type: "alert", id: String(a._id), label: a.title },
      });
    }
  }
  return entries;
}

async function collectEvacuationEntries() {
  const logs = await EvacuationLog.find()
    .sort({ createdAt: -1 })
    .limit(SOURCE_LIMIT)
    .lean();

  return logs.map((l) => ({
    domain: "evacuation",
    action: l.action,
    actorName: l.user?.name || "Unknown",
    actorRole: null,
    at: l.createdAt,
    notes: `${l.previousValue ?? "—"} → ${l.newValue ?? "—"}`,
    target: { type: "evacuation_center", id: String(l.centerId), label: l.centerName },
  }));
}

async function collectAuditLogEntries() {
  const logs = await AuditLog.find().sort({ at: -1 }).limit(SOURCE_LIMIT).lean();

  return logs.map((l) => ({
    domain: l.domain,
    action: l.action,
    actorName: l.actorName,
    actorRole: l.actorRole || null,
    at: l.at,
    notes: l.notes || "",
    target: l.target || null,
  }));
}

// GET /api/audit-logs?domain=&action=&search=&from=&to=&page=&limit=
router.get("/", protect, requireRole("system_admin"), async (req, res) => {
  try {
    const { domain, action, search, from, to } = req.query;

    if (domain && !DOMAIN_FILTERS[domain]) {
      return res.status(400).json({ message: "Invalid domain" });
    }

    const [chatCase, chatUser, emergencyReport, alert, evacuation, auditLog] = await Promise.all([
      collectChatCaseEntries(),
      collectChatUserEntries(),
      collectEmergencyReportEntries(),
      collectAlertEntries(),
      collectEvacuationEntries(),
      collectAuditLogEntries(),
    ]);

    let entries = [...chatCase, ...chatUser, ...emergencyReport, ...alert, ...evacuation, ...auditLog];

    if (domain) entries = entries.filter(DOMAIN_FILTERS[domain]);
    if (action) entries = entries.filter((e) => e.action === action);

    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate)) entries = entries.filter((e) => new Date(e.at) >= fromDate);
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate)) entries = entries.filter((e) => new Date(e.at) <= toDate);
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      entries = entries.filter(
        (e) =>
          e.actorName?.toLowerCase().includes(q) ||
          e.target?.label?.toLowerCase().includes(q) ||
          e.action?.toLowerCase().includes(q),
      );
    }

    entries.sort((a, b) => new Date(b.at) - new Date(a.at));

    const total = entries.length;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const paged = entries.slice((page - 1) * limit, (page - 1) * limit + limit);

    res.json({ success: true, entries: paged, total, page, limit });
  } catch (err) {
    console.error("[AuditLogs] list failed:", err.message);
    res.status(500).json({ message: "Failed to load audit logs" });
  }
});

export default router;
