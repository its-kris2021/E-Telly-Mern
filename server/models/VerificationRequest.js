import mongoose from "mongoose";

export const VERIFICATION_STATUSES = ["pending", "approved", "rejected"];

export const DOCUMENT_TYPES = [
  "barangay_certificate",
  "government_id",
  "barangay_clearance",
  "other",
];

const VerificationLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    byId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    byName: { type: String, required: true },
    byRole: { type: String, required: true },
    at: { type: Date, default: Date.now },
    notes: { type: String, default: "" },
  },
  { _id: false },
);

// One document per resident-verification submission. A user may have
// multiple over time (e.g. a rejected attempt followed by a resubmission) —
// routes/verification.js always reads/writes the most recent one.
const VerificationRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    userEmail: { type: String, required: true },
    userName: { type: String, required: true },
    declaredBarangay: { type: String, default: "" },
    declaredCity: { type: String, default: "Antipolo City" },

    documentType: { type: String, enum: DOCUMENT_TYPES, required: true },
    documentUrls: { type: [String], default: [] },

    status: { type: String, enum: VERIFICATION_STATUSES, default: "pending" },
    adminNotes: { type: String, default: "" },
    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },

    logs: { type: [VerificationLogSchema], default: [] },
  },
  { timestamps: true },
);

VerificationRequestSchema.index({ userId: 1, createdAt: -1 });
VerificationRequestSchema.index({ status: 1 });

export default mongoose.model("VerificationRequest", VerificationRequestSchema);
