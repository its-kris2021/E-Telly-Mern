import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import RiskModel from "./models/RiskModel.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });
await mongoose.connect(process.env.MONGO_URI);

for (const hazardType of ["flood", "landslide"]) {
  const all = await RiskModel.find({ hazardType }).sort({ version: 1 }).lean();
  const active = all.filter(m => m.isActive);
  console.log(`${hazardType}: versions=[${all.map(m => m.version).join(",")}] active=[${active.map(m => m.version).join(",")}]`);
}

await mongoose.disconnect();
process.exit(0);
