import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/user.js";
import { protect, requireRole } from "../middleware/auth.js";
import { BARANGAY_KEYS } from "../config/barangays.js";
import { recordAuditLog } from "../services/auditLog.js";

function logUserAction(req, action, target, notes = "") {
  return recordAuditLog({
    domain: "user_management",
    action,
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    notes,
    target,
  });
}

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

// Validates/derives assignedBarangay for a given target role: required + must
// be a known barangay key for "barangay_official", must be absent for every
// other role (residents/system_admin/cdrrmo have no barangay assignment).
// Returns { ok: true, value } or { ok: false, message }.
function resolveAssignedBarangay(role, assignedBarangay) {
  if (role === "barangay_official") {
    if (!assignedBarangay || !BARANGAY_KEYS.includes(assignedBarangay)) {
      return { ok: false, message: "A valid assigned barangay is required for Barangay Official accounts." };
    }
    return { ok: true, value: assignedBarangay };
  }
  return { ok: true, value: null };
}

// True if `excludeId` is currently a system_admin AND no other system_admin
// account exists — i.e. deleting/demoting/rejecting it would leave the
// platform with zero System Admins and no recovery path short of a manual
// DB edit. Callers use this to block that specific action, not any action
// on a system_admin in general.
async function isOnlySystemAdmin(excludeId) {
  const others = await User.countDocuments({ role: "system_admin", _id: { $ne: excludeId } });
  return others === 0;
}

// GET /api/users — list all users (system admin only)
router.get("/", protect, requireRole("system_admin"), async (req, res) => {
  try {
    const users = await User.find()
      .select("-password")
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

// POST /api/users — create user (system admin only)
router.post("/", protect, requireRole("system_admin"), async (req, res) => {
  const { firstName, lastName, role, password, contactEmail, assignedBarangay } = req.body;
  // Normalize to lowercase — matches every other account-creation path
  // (register, google) and how routes/auth.js always queries at login.
  // Without this, an admin-created account with any uppercase letter in its
  // email (the auto-generated "LastF@etelly.com" pattern always has one)
  // could never log in — the stored email just wouldn't match the lookup.
  const email = req.body.email?.trim().toLowerCase();
  try {
    const existing = await User.findOne({ email });
    if (existing)
      return res.status(400).json({ message: "Email already exists" });

    const barangayResult = resolveAssignedBarangay(role, assignedBarangay);
    if (!barangayResult.ok)
      return res.status(400).json({ message: barangayResult.message });

    const hashed = await bcrypt.hash(password, 12);
    const fullName = `${firstName} ${lastName}`.trim();

    const newUser = await User.create({
      name: fullName,
      email,
      password: hashed,
      role,
      assignedBarangay: barangayResult.value,
      mustChangePassword: true,
      contactEmail: contactEmail?.trim() || "",
    });

    await logUserAction(
      req,
      "create",
      { type: "user", id: String(newUser._id), label: newUser.name },
      `role: ${newUser.role}`,
    );

    res.status(201).json({
      id: newUser._id,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      assignedBarangay: newUser.assignedBarangay,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to create user" });
  }
});

// PUT /api/users/:id — update user (system admin only)
router.put("/:id", protect, requireRole("system_admin"), async (req, res) => {
  const { firstName, lastName, role, password, contactEmail, assignedBarangay } = req.body;
  try {
    const before = await User.findById(req.params.id).select("-password");
    if (!before) return res.status(404).json({ message: "User not found" });

    if (before.role === "system_admin" && role !== "system_admin" && (await isOnlySystemAdmin(before._id))) {
      return res.status(409).json({ message: "Cannot change the role of the only remaining System Admin account." });
    }

    const barangayResult = resolveAssignedBarangay(role, assignedBarangay);
    if (!barangayResult.ok)
      return res.status(400).json({ message: barangayResult.message });

    const fullName = `${firstName} ${lastName}`.trim();
    const updateData = {
      name: fullName,
      role,
      assignedBarangay: barangayResult.value,
      contactEmail: contactEmail?.trim() || "",
    };

    if (password) {
      updateData.password = await bcrypt.hash(password, 12);
    }

    const updated = await User.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
    }).select("-password");

    await logUserAction(
      req,
      "update",
      { type: "user", id: String(updated._id), label: updated.name },
      before.role !== role ? `role: ${before.role} → ${role}` : "profile updated",
    );

    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: "Failed to update user" });
  }
});

// POST /api/users/:id/reset-password — system admin resets a user's password
// Returns the plaintext temp password once so the admin can share it.
router.post("/:id/reset-password", protect, requireRole("system_admin"), async (req, res) => {
  try {
    const tempPassword = generateStrongPassword();
    const hashed = await bcrypt.hash(tempPassword, 12);

    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { password: hashed, mustChangePassword: true },
      { new: true },
    );

    if (!updated) return res.status(404).json({ message: "User not found" });

    await logUserAction(req, "reset_password", { type: "user", id: String(updated._id), label: updated.name });

    res.json({ tempPassword });
  } catch (err) {
    res.status(500).json({ message: "Failed to reset password" });
  }
});

// DELETE /api/users/:id — delete user (system admin only)
router.delete("/:id", protect, requireRole("system_admin"), async (req, res) => {
  try {
    const target = await User.findById(req.params.id).select("role name");
    if (!target) return res.status(404).json({ message: "User not found" });
    if (target.role === "system_admin" && (await isOnlySystemAdmin(target._id))) {
      return res.status(409).json({ message: "Cannot delete the only remaining System Admin account." });
    }

    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "User not found" });

    await logUserAction(req, "delete", { type: "user", id: String(target._id), label: target.name }, `role: ${target.role}`);

    res.json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete user" });
  }
});

export default router;
