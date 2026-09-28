import mongoose from "mongoose";

const schema = new mongoose.Schema(
  {
    centerId:   { type: mongoose.Schema.Types.ObjectId, ref: "EvacuationCenter", required: true },
    centerName: String,
    barangay:   String,
    action: {
      type: String,
      enum: ["occupancy_update", "capacity_update", "reset", "availability_update", "center_created", "center_deleted"],
      required: true,
    },
    previousValue: Number,
    newValue:      Number,
    delta:         Number,
    user: {
      id:   mongoose.Schema.Types.ObjectId,
      name: String,
    },
  },
  { timestamps: true },
);

export default mongoose.model("EvacuationLog", schema);
