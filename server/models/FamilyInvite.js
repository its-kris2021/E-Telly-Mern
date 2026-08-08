import mongoose from "mongoose";

const familyInviteSchema = new mongoose.Schema(
  {
    family: { type: mongoose.Schema.Types.ObjectId, ref: "Family", required: true },
    inviter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    inviteeEmail: { type: String, required: true, lowercase: true, trim: true },
    relationship: { type: String, required: true },
    token: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "expired", "cancelled"],
      default: "pending",
    },
    expiresAt: { type: Date, required: true },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

familyInviteSchema.index({ inviteeEmail: 1, status: 1 });
familyInviteSchema.index({ family: 1, inviteeEmail: 1 });

export default mongoose.models.FamilyInvite || mongoose.model("FamilyInvite", familyInviteSchema);
