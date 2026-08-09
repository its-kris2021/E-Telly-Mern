import mongoose from "mongoose";

export const REPORT_REASONS = [
  "spam",
  "abusive",
  "bullying",
  "harassment",
  "threats",
  "hate_speech",
  "inappropriate_content",
  "scam",
  "violence",
  "other",
];

const MessageReportSchema = new mongoose.Schema({
  messageId:       { type: mongoose.Schema.Types.ObjectId, required: true },
  reporterId:      { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
  reportedUserId:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  reason:          { type: String, required: true, enum: REPORT_REASONS },
  details:         { type: String, default: "", maxlength: 500 },
  messageSnapshot: { type: String, default: "" },
  status:          { type: String, enum: ["pending", "reviewed", "dismissed"], default: "pending" },
  createdAt:       { type: Date, default: Date.now },
});

// Enforces "many users can report the same message, but not the same user twice".
MessageReportSchema.index({ messageId: 1, reporterId: 1 }, { unique: true });

export default mongoose.model("MessageReport", MessageReportSchema);
