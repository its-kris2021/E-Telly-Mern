import mongoose from "mongoose";
import { BARANGAY_KEYS } from "../config/barangays.js";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, default: '' },
    role: {
      type: String,
      // "admin" is kept temporarily during the system_admin/cdrrmo role
      // split migration (scripts/migrateAdminRoles.js) — drop it once no
      // documents use it any more.
      enum: ["admin", "system_admin", "cdrrmo", "barangay_official", "user"],
      default: "user",
    },
    // Only meaningful for role: "barangay_official" — scopes reports/alerts/
    // evacuation-center access to this barangay. Null for every other role.
    assignedBarangay: {
      type: String,
      enum: [...BARANGAY_KEYS, null],
      default: null,
    },
    mustChangePassword: { type: Boolean, default: false },
    contactEmail: { type: String, default: "" },
    address: { type: String, default: "" },
    // Structured mirror of `address` for residents — the Profile screen
    // reads/writes these as discrete fields (barangay dropdown, street
    // input, landmark input), separately from the single concatenated
    // `address` string other screens display.
    barangay: { type: String, default: "" },
    streetDetails: { type: String, default: "" },
    landmark: { type: String, default: "" },
    phoneNumber: { type: String, default: "" },
    termsAccepted: { type: Boolean, default: false },
    termsAcceptedAt: { type: Date, default: null },
    termsAcceptedVersion: { type: String, default: "" },
  },
  { timestamps: true },
);

export default mongoose.model("User", userSchema);
