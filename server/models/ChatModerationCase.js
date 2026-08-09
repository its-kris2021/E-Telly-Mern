import mongoose from "mongoose";
import { REPORT_REASONS } from "./MessageReport.js";

export const CASE_STATUSES = ["pending", "resolved", "dismissed"];

const defaultReasonCounts = () =>
  REPORT_REASONS.reduce((acc, reason) => {
    acc[reason] = 0;
    return acc;
  }, {});

const ModeratorNoteSchema = new mongoose.Schema(
  {
    note: { type: String, required: true, maxlength: 1000 },
    byId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    byName: { type: String, required: true },
    byRole: { type: String, required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const CaseLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    byId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    byName: { type: String, required: true },
    byRole: { type: String, required: true },
    at: { type: Date, default: Date.now },
    notes: { type: String, default: "" },
  },
  { _id: false },
);

// One document per reported chat message — aggregates every MessageReport
// filed against it into a single reviewable case, so status/notes have one
// consistent home even when multiple users report the same message for
// different reasons. See server/models/MessageReport.js for the per-reporter
// evidence rows this is built from.
const ChatModerationCaseSchema = new mongoose.Schema({
  messageId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  reportedUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  // Reported user's own registered-profile barangay (resolved once, at case
  // creation, from the users collection) — mirrors reporterBarangayKey in
  // routes/reports.js, but keyed off the person being reported rather than
  // the person filing the report, since a barangay_official moderates
  // residents in their own barangay.
  reportedUserBarangayKey: { type: String, default: null },
  messageSnapshot: { type: String, default: "" },
  conversationParticipants: [{ type: mongoose.Schema.Types.ObjectId }],

  // Also the unique-reporter count: the MessageReport unique index on
  // {messageId, reporterId} guarantees at most one report per user.
  reportCount: { type: Number, default: 0 },
  reasonCounts: { type: Object, default: defaultReasonCounts },

  status: { type: String, enum: CASE_STATUSES, default: "pending" },

  moderatorNotes: { type: [ModeratorNoteSchema], default: [] },
  logs: { type: [CaseLogSchema], default: [] },

  reviewedBy: { type: String, default: null },
  reviewedAt: { type: Date, default: null },

  firstReportedAt: { type: Date, default: Date.now },
  lastReportedAt: { type: Date, default: Date.now },
}, { timestamps: true });

ChatModerationCaseSchema.index({ status: 1 });
ChatModerationCaseSchema.index({ reportedUserBarangayKey: 1 });

export default mongoose.model("ChatModerationCase", ChatModerationCaseSchema);
