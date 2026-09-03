import express from "express";
import mongoose from "mongoose";
import { protect } from "../middleware/auth.js";
import MessageReport, { REPORT_REASONS } from "../models/MessageReport.js";
import ChatModerationCase from "../models/ChatModerationCase.js";
import { resolveBarangayKey } from "../config/barangays.js";
import {
  applyConfirmedViolation,
  AUTO_RESTRICT_REPORTER_THRESHOLD,
  AUTO_RESTRICT_WINDOW_MS,
} from "../services/chatRestrictionService.js";
import { sendPushToUser } from "./push.js";

const router = express.Router();

// The schemaless `messages` collection is written by the mobile client, so
// senderId/receiverId aren't guaranteed to already be ObjectId instances —
// normalize defensively rather than assuming a shape.
function toObjectId(val) {
  if (val instanceof mongoose.Types.ObjectId) return val;
  if (typeof val === "string" && mongoose.isValidObjectId(val)) {
    return new mongoose.Types.ObjectId(val);
  }
  return null;
}

// Aggregates the new MessageReport into its message's moderation case —
// creating the case on first report, incrementing counts on subsequent ones.
// Mirrors the reporterBarangayKey resolution in routes/reports.js, but
// resolves the *reported* user's barangay (not the reporter's), since Chat
// Monitoring scopes a barangay_official's visibility to residents in their
// own barangay.
async function upsertModerationCase(message, reason) {
  const existing = await ChatModerationCase.findOne({ messageId: message._id }).select("_id");

  const senderObjectId = toObjectId(message.senderId);
  const receiverObjectId = toObjectId(message.receiverId);

  let reportedUserBarangayKey = null;
  if (!existing && senderObjectId) {
    const reportedUser = await mongoose.connection.db
      .collection("users")
      .findOne({ _id: senderObjectId }, { projection: { address: 1 } });
    reportedUserBarangayKey = reportedUser ? resolveBarangayKey(reportedUser.address) : null;
  }

  await ChatModerationCase.updateOne(
    { messageId: message._id },
    {
      $inc: { reportCount: 1, [`reasonCounts.${reason}`]: 1 },
      $set: { lastReportedAt: new Date() },
      $setOnInsert: {
        reportedUserId: senderObjectId,
        reportedUserBarangayKey,
        messageSnapshot: message.text || "",
        conversationParticipants: [senderObjectId, receiverObjectId].filter(Boolean),
        firstReportedAt: new Date(),
        status: "pending",
      },
    },
    { upsert: true },
  );
}

// Auto-resolves a still-pending case the moment enough *distinct* users have
// reported it recently — same escalation ladder as a human moderator's "Send
// Warning" click (see applyConfirmedViolation), just without waiting for one.
// Requiring several independent reporters within a short window (rather than
// a raw lifetime report count) makes this hard to abuse: one person can only
// ever file one report per message (unique index in MessageReport), so a
// single bad-faith account can't trigger it alone.
async function maybeAutoRestrict(messageId) {
  const since = new Date(Date.now() - AUTO_RESTRICT_WINDOW_MS);
  const distinctReporters = await MessageReport.distinct("reporterId", {
    messageId,
    createdAt: { $gte: since },
  });
  if (distinctReporters.length < AUTO_RESTRICT_REPORTER_THRESHOLD) return;

  // Atomically flip pending -> resolved first so two reports landing at
  // nearly the same moment can't both win the race and double-apply the
  // violation. Only the request that actually performed this flip proceeds.
  const caseDoc = await ChatModerationCase.findOneAndUpdate(
    { messageId, status: "pending" },
    { $set: { status: "resolved" } },
  );
  if (!caseDoc || !caseDoc.reportedUserId) return;

  const note = `Automatically resolved — ${distinctReporters.length} distinct users reported this message within 24 hours`;
  const { profile, restrictionJustApplied } = await applyConfirmedViolation({
    caseDoc,
    actorId: null,
    actorName: "System (auto-moderation)",
    actorRole: "system",
    note,
  });

  const reports = await MessageReport.find({ messageId }).select("reporterId").lean();
  Promise.allSettled(
    reports.map((r) => sendPushToUser(r.reporterId, {
      title: "Report reviewed",
      body: "Thanks for the report — multiple users flagged this message and it was automatically reviewed.",
      url: "/chats",
      tag: `chat-report-${caseDoc._id}`,
    })),
  ).catch((err) => console.error("[MessageReports] auto-restrict reporter notification failed:", err.message));

  const warnedBody = restrictionJustApplied
    ? `Your message was found to violate community guidelines after multiple reports (warning #${profile.warningCount}). Chat access is temporarily restricted.`
    : `Your message was found to violate community guidelines after multiple reports (warning #${profile.warningCount}). Further violations may restrict your chat access.`;
  sendPushToUser(caseDoc.reportedUserId, {
    title: "Chat warning issued",
    body: warnedBody,
    url: "/chats",
    tag: `chat-warning-${caseDoc._id}`,
    urgent: restrictionJustApplied,
  }).catch((err) => console.error("[MessageReports] auto-restrict warned-user notification failed:", err.message));
}

// POST /api/message-reports - report a chat message for abuse
router.post("/", protect, async (req, res) => {
  try {
    const { messageId, reason, details } = req.body;

    if (!messageId || !mongoose.isValidObjectId(messageId)) {
      return res.status(400).json({ message: "Invalid messageId" });
    }
    if (!REPORT_REASONS.includes(reason)) {
      return res.status(400).json({ message: "Invalid reason" });
    }

    // The general chat `messages` collection is schemaless (written directly
    // by the mobile client via mongo_dart), so it's read via the raw driver
    // rather than a Mongoose model — same pattern routes/reports.js uses for
    // emergency_reports weather-snapshot lookups.
    const message = await mongoose.connection.db
      .collection("messages")
      .findOne({ _id: new mongoose.Types.ObjectId(messageId) });

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    const report = await MessageReport.create({
      messageId: message._id,
      reporterId: req.user.id,
      reportedUserId: message.senderId,
      reason,
      details: typeof details === "string" ? details.slice(0, 500) : "",
      messageSnapshot: message.text || "",
    });

    await upsertModerationCase(message, reason);

    try {
      await maybeAutoRestrict(message._id);
    } catch (err) {
      // The report itself already succeeded — a failed auto-moderation
      // check shouldn't turn that into an error response.
      console.error("[MessageReports] auto-restrict check failed:", err.message);
    }

    res.status(201).json({ success: true, report });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "You have already reported this message" });
    }
    console.error("[MessageReports] create failed:", err.message);
    res.status(500).json({ message: "Failed to submit report" });
  }
});

// GET /api/message-reports/mine?messageIds=id1,id2,... - which of these
// messages has the current user already reported (used to disable the
// "Report" option client-side after a restart).
router.get("/mine", protect, async (req, res) => {
  try {
    const raw = typeof req.query.messageIds === "string" ? req.query.messageIds : "";
    const ids = raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (ids.length === 0) {
      return res.json({ reportedMessageIds: [] });
    }

    const reports = await MessageReport.find({
      reporterId: req.user.id,
      messageId: { $in: ids },
    }).select("messageId");

    res.json({
      reportedMessageIds: reports.map((r) => r.messageId.toString()),
    });
  } catch (err) {
    console.error("[MessageReports] mine lookup failed:", err.message);
    res.status(500).json({ message: "Failed to load report status" });
  }
});

export default router;
