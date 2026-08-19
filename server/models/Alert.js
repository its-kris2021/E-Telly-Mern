// models/Alert.js
import mongoose from "mongoose";

const actionLogSchema = new mongoose.Schema({
  action: { type: String, enum: ["created", "dismissed", "resolved"] },
  by: { type: String, required: true },
  at: { type: Date, default: Date.now },
});

const AlertSchema = new mongoose.Schema({
  source: {
    type: String,
    enum: ["system", "residents", "CDRRMO", "Barangay", "USGS", "GDACS", "ai"],
    required: true,
  },
  type: {
    type: String,
    enum: [
      "fire",
      "flood",
      "rainfall",
      "earthquake",
      "lahar",
      "typhoon",
      "storm",
      "landslide",
      "rescue",
      "other",
    ],
    required: true,
  },
  severity: {
    type: String,
    enum: ["watch", "warning", "critical", "evacuate"],
    required: true,
  },
  title: { type: String, required: true },
  description: { type: String, required: true },
  location: { type: String, default: "" },
  barangays: [String],
  raw: String,
  lat: { type: Number, default: null },
  lng: { type: Number, default: null },
  isManual: { type: Boolean, default: false },
  linkedReportId: { type: mongoose.Schema.Types.ObjectId, default: null },
  isActive: { type: Boolean, default: true },
  actionLog: [actionLogSchema],

  // ── AI-predicted alerts only (source: "ai") ──────────────────────────────
  confidence:   { type: Number, default: null }, // model's predicted probability, 0-1
  modelVersion: { type: String, default: null }, // e.g. "flood-v3" — see models/RiskModel.js
  confirmedOutcome: {
    type: String,
    enum: ["unconfirmed", "true_positive", "false_positive"],
    default: "unconfirmed",
  },
  confirmedBy: { type: String, default: null }, // admin userId/name, or "auto:linked_report" / "auto:expired_unconfirmed"
  confirmedAt: { type: Date, default: null },
  _dedupeKey: { type: String, index: true },
  rawKey: { type: String, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  expiresAt: Date,

  // Ed25519 signature over this alert's canonical fields (see
  // services/alertSigning.js), verified client-side by the mobile app
  // before it trusts/relays an alert received over its offline P2P mesh
  // instead of straight from this server. Null for an alert created before
  // signing was deployed, or if ALERT_SIGNING_PRIVATE_KEY isn't configured
  // on this instance — such alerts still display normally, they just can't
  // be gossiped phone-to-phone.
  signature: { type: String, default: null },
  keyId: { type: Number, default: null },
});

export default mongoose.model("Alert", AlertSchema);
