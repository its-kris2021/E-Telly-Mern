// models/RetrainRun.js
//
// One document per trainRiskModels() invocation (nightly cron, or the
// standalone `node scripts/trainRiskModel.js` CLI path). Written "running"
// at start, updated to "completed"/"error" at the end. A "running" row with
// no later completed/error row from the same night is itself the
// diagnostic signal that the process was killed mid-run (e.g. an R14/R15
// OOM SIGKILL — an OS-level kill no application code can catch or log after
// the fact). Exists because Heroku's log buffer is ephemeral and this
// project has no other way to see that gap the next morning.
import mongoose from "mongoose";

const hazardOutcomeSchema = new mongoose.Schema(
  {
    status: { type: String, default: null },
    version: { type: Number, default: null },
    rowCount: { type: Number, default: null },
    error: { type: String, default: null },
  },
  { _id: false },
);

const retrainRunSchema = new mongoose.Schema({
  startedAt: { type: Date, required: true, default: Date.now, index: true },
  finishedAt: { type: Date, default: null },
  status: {
    type: String,
    enum: ["running", "completed", "error", "presumed_crashed"],
    default: "running",
    index: true,
  },
  error: { type: String, default: null },
  hazards: {
    flood: { type: hazardOutcomeSchema, default: () => ({}) },
    landslide: { type: hazardOutcomeSchema, default: () => ({}) },
  },
});

export default mongoose.model("RetrainRun", retrainRunSchema);
