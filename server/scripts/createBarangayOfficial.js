import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import User from "../models/user.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const EMAIL = "josh@etelly.com";
const PASSWORD = "josh123";
const NAME = "Josh";
const ASSIGNED_BARANGAY = "bagongnayon"; // Bagong Nayon

await mongoose.connect(process.env.MONGO_URI);
console.log("Connected to MongoDB...");

const existing = await User.findOne({ email: EMAIL });

if (existing) {
  console.log("⚠️  Barangay official already exists!");
} else {
  const hashed = await bcrypt.hash(PASSWORD, 12);
  await User.create({
    name: NAME,
    email: EMAIL,
    password: hashed,
    role: "barangay_official",
    assignedBarangay: ASSIGNED_BARANGAY,
  });
  console.log("✅ Barangay official account created!");
  console.log("   Email:    ", EMAIL);
  console.log("   Password: ", PASSWORD);
  console.log("   Barangay: Bagong Nayon");
}

await mongoose.disconnect();
process.exit(0);
