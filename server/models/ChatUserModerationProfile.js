import mongoose from "mongoose";

export const PROFILE_HISTORY_ACTIONS = [
  "warning_issued",
  "restriction_applied",
  "case_resolved",
  "case_dismissed",
];

const HistoryEntrySchema = new mongoose.Schema(
  {
    action: { type: String, enum: PROFILE_HISTORY_ACTIONS, required: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, required: true },
    messageId: { type: mongoose.Schema.Types.ObjectId, required: true },
    byId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    byName: { type: String, required: true },
    byRole: { type: String, required: true },
    at: { type: Date, default: Date.now },
    note: { type: String, default: "" },
  },
  { _id: false },
);

// Per-reported-user moderation record — separate from ChatModerationCase
// (which is per reported *message*) because warnings and restrictions are a
// property of the person and must accumulate across every case ever opened
// against them, not reset per case. See routes/chatModeration.js's
// POST /cases/:messageId/warn for the escalation logic that writes here:
// 1st confirmed violation -> warning #1, 2nd -> warning #2 + auto restriction.
const ChatUserModerationProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  warningCount: { type: Number, default: 0 },
  restricted: { type: Boolean, default: false },
  restrictedAt: { type: Date, default: null },
  history: { type: [HistoryEntrySchema], default: [] },
}, { timestamps: true });

export default mongoose.model("ChatUserModerationProfile", ChatUserModerationProfileSchema);
