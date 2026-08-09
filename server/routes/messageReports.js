import express from "express";
import mongoose from "mongoose";
import { protect } from "../middleware/auth.js";
import MessageReport, { REPORT_REASONS } from "../models/MessageReport.js";
import ChatModerationCase from "../models/ChatModerationCase.js";
import { resolveBarangayKey } from "../config/barangays.js";

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
