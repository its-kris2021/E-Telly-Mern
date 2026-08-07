import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/user.js";
import { protect, requireAdmin } from "../middleware/auth.js";

const router = express.Router();

// ── Strong password generator (server-side, used for admin resets) ────────────
function generateStrongPassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%^&*";
  const all = upper + lower + digits + special;

  const chars = [
    upper[Math.floor(Math.random() * upper.length)],
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    digits[Math.floor(Math.random() * digits.length)],
    special[Math.floor(Math.random() * special.length)],
    special[Math.floor(Math.random() * special.length)],
  ];

  while (chars.length < 16) {
    chars.push(all[Math.floor(Math.random() * all.length)]);
  }

  return chars.sort(() => Math.random() - 0.5).join("");
}

// GET /api/users — list all users (admin only)
router.get("/", protect, requireAdmin, async (req, res) => {
  try {
    const users = await User.find()
      .select("-password")
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

// POST /api/users — create user (admin only)
router.post("/", protect, requireAdmin, async (req, res) => {
  const { email, firstName, lastName, role, password, contactEmail } = req.body;
  try {
    const existing = await User.findOne({ email });
    if (existing)
      return res.status(400).json({ message: "Email already exists" });

    const hashed = await bcrypt.hash(password, 12);
    const fullName = `${firstName} ${lastName}`.trim();

    const newUser = await User.create({
      name: fullName,
      email,
      password: hashed,
      role,
      mustChangePassword: true,
      contactEmail: contactEmail?.trim() || "",
    });

    res.status(201).json({
      id: newUser._id,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to create user" });
  }
});

// PUT /api/users/:id — update user (admin only)
router.put("/:id", protect, requireAdmin, async (req, res) => {
  const { firstName, lastName, role, password, contactEmail } = req.body;
  try {
    const fullName = `${firstName} ${lastName}`.trim();
    const updateData = { name: fullName, role, contactEmail: contactEmail?.trim() || "" };

    if (password) {
      updateData.password = await bcrypt.hash(password, 12);
    }

    const updated = await User.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
    }).select("-password");

    if (!updated) return res.status(404).json({ message: "User not found" });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: "Failed to update user" });
  }
});

// POST /api/users/:id/reset-password — admin resets a user's password
// Returns the plaintext temp password once so the admin can share it.
router.post("/:id/reset-password", protect, requireAdmin, async (req, res) => {
  try {
    const tempPassword = generateStrongPassword();
    const hashed = await bcrypt.hash(tempPassword, 12);

    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { password: hashed, mustChangePassword: true },
      { new: true },
    );

    if (!updated) return res.status(404).json({ message: "User not found" });

    res.json({ tempPassword });
  } catch (err) {
    res.status(500).json({ message: "Failed to reset password" });
  }
});

// DELETE /api/users/:id — delete user (admin only)
router.delete("/:id", protect, requireAdmin, async (req, res) => {
  try {
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "User not found" });

    res.json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete user" });
  }
});

export default router;
