import mongoose from "mongoose";

export const PROFILE_HISTORY_ACTIONS = [
  "warning_issued",
  "restriction_applied",
  "restriction_removed",
  "restriction_expired",
  "case_resolved",
  "case_dismissed",
];

export const RESTRICTION_TYPES = ["none", "temporary", "permanent"];

const HistoryEntrySchema = new mongoose.Schema(
  {
    action: { type: String, enum: PROFILE_HISTORY_ACTIONS, required: true },
    // Optional: only case-driven entries (warning_issued from a review, the
    // restriction_applied that can follow it, case_resolved/case_dismissed)
    // have a source case/message. Manually-applied/removed restrictions and
    // system-generated restriction_expired entries have none.
    caseId: { type: mongoose.Schema.Types.ObjectId, default: null },
    messageId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Optional: restriction_expired entries are written by the server on
    // lazy expiry checks, not by a logged-in actor.
    byId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    byName: { type: String, default: "System" },
    byRole: { type: String, default: "system" },
    at: { type: Date, default: Date.now },
    note: { type: String, default: "" },
  },
  { _id: false },
);

// Per-reported-user moderation record — separate from ChatModerationCase
// (which is per reported *message*) because warnings and restrictions are a
// property of the person and must accumulate across every case ever opened
// against them, not reset per case. See services/chatRestrictionService.js
// for the escalation ladder (1st confirmed violation -> warning only, 2nd ->
// 24h, 3rd -> 3 days, 4th+ -> 7 days) and routes/chatModeration.js for the
// manual admin actions (temporary override, permanent restriction, clear).
//
// `restricted`/`restrictedAt` mirror restrictionType !== "none" and are kept
// for backward compatibility with existing readers (ChatReportCaseTile.jsx,
// the warn-flow tests) — new code should prefer the richer restriction*
// fields below, which are the source of truth.
const ChatUserModerationProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  warningCount: { type: Number, default: 0 },
  restricted: { type: Boolean, default: false },
  restrictedAt: { type: Date, default: null },
  restrictionType: { type: String, enum: RESTRICTION_TYPES, default: "none" },
  restrictionStartAt: { type: Date, default: null },
  // null for "permanent" (no expiry) and "none"; set for "temporary".
  restrictionEndAt: { type: Date, default: null },
  history: { type: [HistoryEntrySchema], default: [] },
}, { timestamps: true });

// Used by the periodic restriction-expiry sweep (runRestrictionExpiryCleanup)
// to find currently-restricted profiles without scanning the whole collection.
ChatUserModerationProfileSchema.index({ restricted: 1, restrictionType: 1 });

export default mongoose.model("ChatUserModerationProfile", ChatUserModerationProfileSchema);
