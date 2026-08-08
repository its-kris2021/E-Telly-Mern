import mongoose from "mongoose";

const ResourceMessageSchema = new mongoose.Schema({
  requestId:  { type: mongoose.Schema.Types.ObjectId, ref: "ResourceRequest", required: true },
  senderId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  senderName: { type: String, required: true },
  senderRole: { type: String, enum: ["resident","cdrrmo","barangay_official"], required: true },
  text:       { type: String, required: true, maxlength: 1000 },
}, { timestamps: true });

ResourceMessageSchema.index({ requestId: 1, createdAt: 1 });

export default mongoose.model("ResourceMessage", ResourceMessageSchema);
