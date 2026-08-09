import express from "express";
import mongoose from "mongoose";
import {
  protect,
  requireRole,
  requireAssignedBarangayIfOfficial,
  scopeToAssignedBarangay,
  rejectIfOutsideAssignedBarangay,
} from "../middleware/auth.js";
import ChatModerationCase, { CASE_STATUSES } from "../models/ChatModerationCase.js";
import ChatUserModerationProfile from "../models/ChatUserModerationProfile.js";
import MessageReport from "../models/MessageReport.js";

const router = express.Router();

const REVIEW_ROLES = ["system_admin", "cdrrmo", "barangay_official"];

router.use(protect, requireRole(...REVIEW_ROLES), requireAssignedBarangayIfOfficial);

function toObjectId(val) {
  if (val instanceof mongoose.Types.ObjectId) return val;
  if (typeof val === "string" && mongoose.isValidObjectId(val)) {
    return new mongoose.Types.ObjectId(val);
  }
  return null;
}

// caseDoc.reportedUserId is sometimes a populated {_id, name, ...} doc
// (routes that .populate() it) and sometimes a raw ObjectId (routes that
// load the case directly for a write) — an ObjectId is still typeof
// "object", so this distinguishes the two by checking for a populated `_id`
// rather than trusting typeof alone.
function reportedUserObjectId(c) {
  return c.reportedUserId && typeof c.reportedUserId === "object" && c.reportedUserId._id
    ? c.reportedUserId._id
    : c.reportedUserId;
}

// Loads a reported user's cross-case moderation profile, creating an empty
// one on first touch (e.g. their first dismissal or warning). Warnings/
// restrictions live here rather than on the case because they must
// accumulate across every case ever opened against this person.
async function getOrCreateProfile(userId) {
  return ChatUserModerationProfile.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId, warningCount: 0, restricted: false, restrictedAt: null } },
    { upsert: true, returnDocument: "after" },
  );
}

// Shape shared by the list and detail views. Deliberately never includes
// individual reporter identity — that's assembled separately in the detail
// route, gated to system_admin only. `profile` is the reported user's
// ChatUserModerationProfile (or null if they've never been warned/dismissed).
function caseSummary(c, profile) {
  const rawId = c.reportedUserId;
  const isPopulated = rawId && typeof rawId === "object" && rawId._id;
  const reportedUser = isPopulated
    ? { id: String(rawId._id), name: rawId.name || "Unknown user" }
    : { id: rawId ? String(rawId) : null, name: "Unknown user" };

  return {
    id: String(c._id),
    messageId: String(c.messageId),
    reportedUser: {
      ...reportedUser,
      barangayKey: c.reportedUserBarangayKey,
      warningCount: profile?.warningCount ?? 0,
      restricted: profile?.restricted ?? false,
    },
    messageSnapshot: c.messageSnapshot,
    reportCount: c.reportCount,
    reasonCounts: c.reasonCounts,
    status: c.status,
    reviewedBy: c.reviewedBy,
    reviewedAt: c.reviewedAt,
    firstReportedAt: c.firstReportedAt,
    lastReportedAt: c.lastReportedAt,
  };
}

// GET /api/chat-monitoring/cases
router.get("/cases", async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { ...scopeToAssignedBarangay(req, "reportedUserBarangayKey") };

    if (status) {
      if (!CASE_STATUSES.includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      filter.status = status;
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const [cases, total] = await Promise.all([
      ChatModerationCase.find(filter)
        .populate("reportedUserId", "name")
        .sort({ lastReportedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ChatModerationCase.countDocuments(filter),
    ]);

    const userIds = cases.map(reportedUserObjectId).filter(Boolean);
    const profiles = await ChatUserModerationProfile.find({ userId: { $in: userIds } }).lean();
    const profileByUserId = new Map(profiles.map((p) => [String(p.userId), p]));

    res.json({
      success: true,
      cases: cases.map((c) => caseSummary(c, profileByUserId.get(String(reportedUserObjectId(c))))),
      total,
      page,
      limit,
    });
  } catch (err) {
    console.error("[ChatModeration] list cases failed:", err.message);
    res.status(500).json({ message: "Failed to load cases" });
  }
});

// GET /api/chat-monitoring/cases/:messageId
router.get("/cases/:messageId", async (req, res) => {
  try {
    const messageId = toObjectId(req.params.messageId);
    if (!messageId) return res.status(400).json({ message: "Invalid messageId" });

    const caseDoc = await ChatModerationCase.findOne({ messageId })
      .populate("reportedUserId", "name email address");
    if (!caseDoc) return res.status(404).json({ message: "Case not found" });

    if (rejectIfOutsideAssignedBarangay(req, res, caseDoc.reportedUserBarangayKey)) return;

    const profile = reportedUserObjectId(caseDoc)
      ? await ChatUserModerationProfile.findOne({ userId: reportedUserObjectId(caseDoc) }).lean()
      : null;

    const isSystemAdmin = req.user.role === "system_admin";

    const reportsQuery = MessageReport.find({ messageId }).sort({ createdAt: 1 });
    if (isSystemAdmin) reportsQuery.populate("reporterId", "name email");
    const reports = await reportsQuery.lean();

    const reports_ = reports.map((r) => {
      const base = {
        reason: r.reason,
        details: r.details || "",
        createdAt: r.createdAt,
      };
      if (isSystemAdmin) {
        base.reporter = r.reporterId && typeof r.reporterId === "object"
          ? { id: String(r.reporterId._id), name: r.reporterId.name, email: r.reporterId.email }
          : { id: String(r.reporterId), name: "Unknown", email: null };
      }
      return base;
    });

    // Conversation context — last ~20 messages between the two participants,
    // up to and including the reported message, read via the raw driver
    // since `messages` is schemaless (same pattern as messageReports.js).
    let conversationContext = [];
    const participants = (caseDoc.conversationParticipants || []).filter(Boolean);
    if (participants.length === 2) {
      const [a, b] = participants;
      const reportedMessage = await mongoose.connection.db
        .collection("messages")
        .findOne({ _id: messageId });
      const beforeTimestamp = reportedMessage?.timestamp ?? new Date();

      conversationContext = await mongoose.connection.db
        .collection("messages")
        .find({
          $or: [
            { senderId: a, receiverId: b },
            { senderId: b, receiverId: a },
          ],
          timestamp: { $lte: beforeTimestamp },
        })
        .sort({ timestamp: -1 })
        .limit(20)
        .toArray();
      conversationContext.reverse();
    }

    res.json({
      success: true,
      case: caseSummary(caseDoc, profile),
      reports: reports_,
      moderatorNotes: caseDoc.moderatorNotes,
      logs: caseDoc.logs,
      conversationContext: conversationContext.map((m) => ({
        id: String(m._id),
        senderId: m.senderId ? String(m.senderId) : null,
        text: m.text,
        timestamp: m.timestamp,
        isReportedMessage: String(m._id) === String(messageId),
      })),
    });
  } catch (err) {
    console.error("[ChatModeration] case detail failed:", err.message);
    res.status(500).json({ message: "Failed to load case" });
  }
});

// PATCH /api/chat-monitoring/cases/:messageId/status
router.patch("/cases/:messageId/status", async (req, res) => {
  try {
    const messageId = toObjectId(req.params.messageId);
    if (!messageId) return res.status(400).json({ message: "Invalid messageId" });

    const { status, note } = req.body;
    if (!CASE_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const caseDoc = await ChatModerationCase.findOne({ messageId });
    if (!caseDoc) return res.status(404).json({ message: "Case not found" });

    if (rejectIfOutsideAssignedBarangay(req, res, caseDoc.reportedUserBarangayKey)) return;

    const trimmedNote = typeof note === "string" ? note.trim().slice(0, 1000) : "";
    const actorName = req.user.name || req.user.email || "staff";
    const now = new Date();

    caseDoc.status = status;
    caseDoc.reviewedBy = actorName;
    caseDoc.reviewedAt = now;
    caseDoc.logs.push({
      action: "status_change",
      byId: req.user.id,
      byName: actorName,
      byRole: req.user.role,
      at: now,
      notes: trimmedNote,
    });

    await caseDoc.save();

    // Dismissals get recorded on the reported user's cross-case profile too
    // (creating it on first touch) — "record all ... dismissals in the
    // audit logs" applies at the person level, not just this one case. A
    // manual "resolved" here (bypassing the warn flow) doesn't touch the
    // profile — only Send Warning increments warningCount.
    let profile = null;
    const userId = reportedUserObjectId(caseDoc);
    if (userId && status === "dismissed") {
      profile = await getOrCreateProfile(userId);
      profile.history.push({
        action: "case_dismissed",
        caseId: caseDoc._id,
        messageId: caseDoc.messageId,
        byId: req.user.id,
        byName: actorName,
        byRole: req.user.role,
        at: now,
        note: trimmedNote,
      });
      await profile.save();
    } else if (userId) {
      profile = await ChatUserModerationProfile.findOne({ userId }).lean();
    }

    res.json({ success: true, case: caseSummary(caseDoc, profile) });
  } catch (err) {
    console.error("[ChatModeration] status update failed:", err.message);
    res.status(500).json({ message: "Failed to update case status" });
  }
});

// POST /api/chat-monitoring/cases/:messageId/warn — replaces the old
// "Start Reviewing" action. Confirms the violation, issues the next warning
// number for the reported user (not the message — repeat reports of the
// same message already collapsed into one case, so this is "one violation"),
// auto-restricts on the 2nd confirmed violation, and auto-resolves the case.
router.post("/cases/:messageId/warn", async (req, res) => {
  try {
    const messageId = toObjectId(req.params.messageId);
    if (!messageId) return res.status(400).json({ message: "Invalid messageId" });

    const caseDoc = await ChatModerationCase.findOne({ messageId });
    if (!caseDoc) return res.status(404).json({ message: "Case not found" });

    if (rejectIfOutsideAssignedBarangay(req, res, caseDoc.reportedUserBarangayKey)) return;

    if (caseDoc.status !== "pending") {
      return res.status(400).json({ message: "Only a pending case can be warned" });
    }

    const userId = reportedUserObjectId(caseDoc);
    if (!userId) {
      return res.status(400).json({ message: "Case has no identifiable reported user" });
    }

    const { note } = req.body;
    const trimmedNote = typeof note === "string" ? note.trim().slice(0, 1000) : "";
    const actorName = req.user.name || req.user.email || "staff";
    const now = new Date();
    const baseEntry = {
      caseId: caseDoc._id,
      messageId: caseDoc.messageId,
      byId: req.user.id,
      byName: actorName,
      byRole: req.user.role,
      at: now,
    };

    const profile = await getOrCreateProfile(userId);
    profile.warningCount += 1;
    profile.history.push({ ...baseEntry, action: "warning_issued", note: trimmedNote });
    caseDoc.logs.push({
      action: "warning_issued", byId: req.user.id, byName: actorName, byRole: req.user.role,
      at: now, notes: trimmedNote,
    });

    let restrictionJustApplied = false;
    if (profile.warningCount === 2 && !profile.restricted) {
      profile.restricted = true;
      profile.restrictedAt = now;
      restrictionJustApplied = true;
      const restrictionNote = "Automatically applied after 2nd confirmed violation";
      profile.history.push({ ...baseEntry, action: "restriction_applied", note: restrictionNote });
      caseDoc.logs.push({
        action: "restriction_applied", byId: req.user.id, byName: actorName, byRole: req.user.role,
        at: now, notes: restrictionNote,
      });
    }

    const resolveNote = restrictionJustApplied
      ? `Resolved — Warning #${profile.warningCount} sent, Chat Restriction applied`
      : `Resolved — Warning #${profile.warningCount} sent`;
    caseDoc.status = "resolved";
    caseDoc.reviewedBy = actorName;
    caseDoc.reviewedAt = now;
    caseDoc.logs.push({
      action: "status_change", byId: req.user.id, byName: actorName, byRole: req.user.role,
      at: now, notes: resolveNote,
    });
    profile.history.push({ ...baseEntry, action: "case_resolved", note: resolveNote });

    await profile.save();
    await caseDoc.save();

    res.json({
      success: true,
      case: caseSummary(caseDoc, profile),
      reportedUser: {
        warningCount: profile.warningCount,
        restricted: profile.restricted,
        restrictedAt: profile.restrictedAt,
      },
    });
  } catch (err) {
    console.error("[ChatModeration] warn failed:", err.message);
    res.status(500).json({ message: "Failed to send warning" });
  }
});

// POST /api/chat-monitoring/cases/:messageId/notes
router.post("/cases/:messageId/notes", async (req, res) => {
  try {
    const messageId = toObjectId(req.params.messageId);
    if (!messageId) return res.status(400).json({ message: "Invalid messageId" });

    const { note } = req.body;
    if (typeof note !== "string" || !note.trim()) {
      return res.status(400).json({ message: "Note text is required" });
    }
    const trimmedNote = note.trim().slice(0, 1000);

    const caseDoc = await ChatModerationCase.findOne({ messageId });
    if (!caseDoc) return res.status(404).json({ message: "Case not found" });

    if (rejectIfOutsideAssignedBarangay(req, res, caseDoc.reportedUserBarangayKey)) return;

    const entry = {
      note: trimmedNote,
      byId: req.user.id,
      byName: req.user.name || req.user.email || "staff",
      byRole: req.user.role,
      at: new Date(),
    };
    caseDoc.moderatorNotes.push(entry);
    caseDoc.logs.push({
      action: "note_added",
      byId: req.user.id,
      byName: entry.byName,
      byRole: req.user.role,
      at: entry.at,
      notes: trimmedNote,
    });

    await caseDoc.save();

    res.status(201).json({ success: true, moderatorNotes: caseDoc.moderatorNotes });
  } catch (err) {
    console.error("[ChatModeration] add note failed:", err.message);
    res.status(500).json({ message: "Failed to add note" });
  }
});

// GET /api/chat-monitoring/users/:userId/summary
router.get("/users/:userId/summary", async (req, res) => {
  try {
    const reportedUserId = toObjectId(req.params.userId);
    if (!reportedUserId) return res.status(400).json({ message: "Invalid userId" });

    const filter = {
      reportedUserId,
      ...scopeToAssignedBarangay(req, "reportedUserBarangayKey"),
    };
    const cases = await ChatModerationCase.find(filter).lean();

    const summary = cases.reduce(
      (acc, c) => {
        acc.totalCases += 1;
        acc.totalReports += c.reportCount;
        acc.byStatus[c.status] = (acc.byStatus[c.status] || 0) + 1;
        for (const [reason, count] of Object.entries(c.reasonCounts || {})) {
          acc.byReason[reason] = (acc.byReason[reason] || 0) + count;
        }
        return acc;
      },
      { totalCases: 0, totalReports: 0, byStatus: {}, byReason: {} },
    );

    const profile = await ChatUserModerationProfile.findOne({ userId: reportedUserId }).lean();

    res.json({
      success: true,
      userId: req.params.userId,
      summary,
      moderation: {
        warningCount: profile?.warningCount ?? 0,
        restricted: profile?.restricted ?? false,
        restrictedAt: profile?.restrictedAt ?? null,
        history: profile?.history ?? [],
      },
    });
  } catch (err) {
    console.error("[ChatModeration] user summary failed:", err.message);
    res.status(500).json({ message: "Failed to load user summary" });
  }
});

// GET /api/chat-monitoring/conversations
router.get("/conversations", async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { ...scopeToAssignedBarangay(req, "reportedUserBarangayKey") };
    if (status) {
      if (!CASE_STATUSES.includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      filter.status = status;
    }

    const cases = await ChatModerationCase.find(filter)
      .populate("reportedUserId", "name")
      .sort({ lastReportedAt: -1 })
      .lean();

    const groups = new Map();
    for (const c of cases) {
      const participants = (c.conversationParticipants || []).map(String).sort();
      const key = participants.join(":");
      if (!groups.has(key)) {
        groups.set(key, {
          participants,
          reportedUser: c.reportedUserId
            ? { id: String(c.reportedUserId._id), name: c.reportedUserId.name }
            : null,
          caseCount: 0,
          lastReportedAt: c.lastReportedAt,
        });
      }
      const group = groups.get(key);
      group.caseCount += 1;
      if (c.lastReportedAt > group.lastReportedAt) group.lastReportedAt = c.lastReportedAt;
    }

    res.json({ success: true, conversations: Array.from(groups.values()) });
  } catch (err) {
    console.error("[ChatModeration] conversations list failed:", err.message);
    res.status(500).json({ message: "Failed to load conversations" });
  }
});

export default router;
