import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import User from "../models/user.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

await mongoose.connect(process.env.MONGO_URI);
console.log("Connected to MongoDB...");

const existing = await User.findOne({ email: "local@etelly.com" });

if (existing) {
  console.log("⚠️  Admin already exists!");
} else {
  const hashed = await bcrypt.hash("local123", 12);
  await User.create({
    name: "Rafael",
    email: "local@etelly.com",
    password: hashed,
    role: "system_admin",
  });
  console.log("✅ Admin account created!");
  console.log("   Email:    local@etelly.com");
  console.log("   Password: local123");
}

await mongoose.disconnect();
process.exit(0);
