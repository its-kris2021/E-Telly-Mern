import mongoose from "mongoose";
import { BARANGAY_KEYS } from "../config/barangays.js";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, default: '' },
    role: {
      type: String,
      enum: ["admin", "user", "barangay_official"],
      default: "user",
    },
    // Only meaningful for role: "barangay_official" — scopes which barangay's
    // reports they can view/act on. Null for admin/user accounts.
    assignedBarangay: {
      type: String,
      enum: [...BARANGAY_KEYS, null],
      default: null,
    },
    mustChangePassword: { type: Boolean, default: false },
    contactEmail: { type: String, default: "" },
    address: { type: String, default: "" },
    termsAccepted: { type: Boolean, default: false },
    termsAcceptedAt: { type: Date, default: null },
    termsAcceptedVersion: { type: String, default: "" },
  },
  { timestamps: true },
);

export default mongoose.model("User", userSchema);
