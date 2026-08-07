import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import admin from "firebase-admin";
import User from "../models/user.js";
import { protect } from "../middleware/auth.js";
import { initFirebase } from "../services/fcm.js";

const router = express.Router();

// ── helpers ──────────────────────────────────────────────────────────────────

function signJwt(user) {
  return jwt.sign(
    { id: user._id, name: user.name, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "1d" },
  );
}

function userPayload(user) {
  return {
    id:                 user._id,
    name:               user.name,
    email:              user.email,
    role:               user.role,
    address:            user.address || "",
    mustChangePassword: user.mustChangePassword ?? false,
  };
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
// Mobile citizen self-registration via Firebase.
// Accepts a Firebase ID token (email may be unverified at this point — verification
// is enforced at login time, not here). Also accepts legacy email+password for
// any non-Firebase callers.
router.post("/register", async (req, res) => {
  const { idToken, name, address, email, password, termsAccepted, termsVersion } = req.body;

  // ── Firebase path (mobile) ──────────────────────────────────────────────────
  if (idToken) {
    if (!name?.trim()) {
      return res.status(400).json({ message: "Name is required." });
    }
    if (termsAccepted !== true) {
      return res.status(400).json({ message: "You must accept the Terms & Conditions and Privacy Policy." });
    }
    try {
      initFirebase();
      const decoded = await admin.auth().verifyIdToken(idToken);
      const normalizedEmail = decoded.email?.toLowerCase();

      if (!normalizedEmail) {
        return res.status(400).json({ message: "Firebase account has no email address." });
      }

      const existing = await User.findOne({ email: normalizedEmail });
      if (existing) {
        return res.status(409).json({ message: "An account with this email already exists." });
      }

      await User.create({
        name:    name.trim(),
        email:   normalizedEmail,
        role:    "user",
        address: address?.trim() || "",
        termsAccepted:        true,
        termsAcceptedAt:      new Date(),
        termsAcceptedVersion: termsVersion || "",
      });

      return res.status(202).json({
        message: "Account created. Please verify your email before signing in.",
      });
    } catch (err) {
      if (err.code?.startsWith("auth/")) {
        return res.status(401).json({ message: "Invalid token. Please try again." });
      }
      console.error("[Auth] Firebase register error:", err.message);
      return res.status(500).json({ message: "Server error" });
    }
  }

  // ── Legacy email+password path ──────────────────────────────────────────────
  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ message: "Name, email, and password are required." });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters." });
  }

  try {
    const existing = await User.findOne({ email: email.trim().toLowerCase() });
    if (existing) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user   = await User.create({
      name:     name.trim(),
      email:    email.trim().toLowerCase(),
      password: hashed,
      role:     "user",
      address:  address?.trim() || "",
    });

    return res.status(201).json({ token: signJwt(user), user: userPayload(user) });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
// Accepts a Firebase ID token (mobile users) OR email+password (admin/legacy).
router.post("/login", async (req, res) => {
  const { idToken, email, password } = req.body;

  // ── Firebase path ───────────────────────────────────────────────────────────
  if (idToken) {
    try {
      initFirebase();
      const decoded = await admin.auth().verifyIdToken(idToken);

      if (!decoded.email_verified) {
        return res.status(403).json({
          message:          "Please verify your email before signing in.",
          needsVerification: true,
        });
      }

      const normalizedEmail = decoded.email?.toLowerCase();
      const user = await User.findOne({ email: normalizedEmail });

      if (!user) {
        return res.status(404).json({ message: "No account found. Please sign up first." });
      }

      return res.json({ token: signJwt(user), user: userPayload(user) });
    } catch (err) {
      if (err.code?.startsWith("auth/")) {
        return res.status(401).json({ message: "Invalid or expired session. Please sign in again." });
      }
      console.error("[Auth] Firebase login error:", err.message);
      return res.status(500).json({ message: "Server error" });
    }
  }

  // ── Legacy email+password path (admin users / web portal) ──────────────────
  if (email && password) {
    try {
      const user = await User.findOne({ email: email.trim().toLowerCase() });
      if (!user) return res.status(400).json({ message: "Incorrect username or password" });

      if (!user.password) {
        return res.status(400).json({ message: "This account uses Google or email sign-in. Please use the mobile app." });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return res.status(400).json({ message: "Incorrect username or password" });

      return res.json({ token: signJwt(user), user: userPayload(user) });
    } catch (err) {
      return res.status(500).json({ message: "Server error" });
    }
  }

  return res.status(400).json({ message: "idToken or email+password required." });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get("/me", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(userPayload(user));
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ── PATCH /api/auth/profile ───────────────────────────────────────────────────
// Authenticated user updates their own address (used after Google sign-in profile completion).
router.patch("/profile", protect, async (req, res) => {
  const { address, termsAccepted, termsVersion } = req.body;
  if (!address?.trim()) {
    return res.status(400).json({ message: "Address is required." });
  }
  try {
    const update = { address: address.trim() };
    if (termsAccepted === true) {
      update.termsAccepted        = true;
      update.termsAcceptedAt      = new Date();
      update.termsAcceptedVersion = termsVersion || "";
    }
    const updated = await User.findByIdAndUpdate(
      req.user.id,
      update,
      { new: true },
    ).select("-password");
    if (!updated) return res.status(404).json({ message: "User not found" });
    res.json(userPayload(updated));
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ── POST /api/auth/change-password ───────────────────────────────────────────
// Authenticated — changes the caller's own password (admin users only, bcrypt path).
const STRONG_RE =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+[\]{};':"\\|,.<>/?`~]).{8,}$/;

router.post("/change-password", protect, async (req, res) => {
  const { newPassword } = req.body;

  if (!newPassword || !STRONG_RE.test(newPassword)) {
    return res.status(400).json({
      message:
        "Password must be at least 8 characters and include an uppercase letter, lowercase letter, number, and special character.",
    });
  }

  try {
    const hashed = await bcrypt.hash(newPassword, 12);
    await User.findByIdAndUpdate(req.user.id, {
      password:           hashed,
      mustChangePassword: false,
    });
    res.json({ message: "Password changed successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ── POST /api/auth/google ─────────────────────────────────────────────────────
// Firebase ID token exchange for Google Sign-In.
// Returns isNewUser: true when an account was just created.
router.post("/google", async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).json({ message: "idToken is required" });
  }

  try {
    initFirebase();
    const decoded = await admin.auth().verifyIdToken(idToken);
    const { email, name } = decoded;

    if (!email) {
      return res.status(400).json({ message: "Google account has no email address" });
    }

    const normalizedEmail = email.toLowerCase();
    let user = await User.findOne({ email: normalizedEmail });
    const isNewUser = !user;

    if (!user) {
      user = await User.create({
        name:     name || normalizedEmail.split("@")[0],
        email:    normalizedEmail,
        password: randomBytes(32).toString("hex"),
        role:     "user",
      });
    }

    res.json({
      token:     signJwt(user),
      user:      userPayload(user),
      isNewUser,
    });
  } catch (err) {
    console.error("[Auth] Google verify failed:", err.message);
    if (err.code?.startsWith("auth/")) {
      return res.status(401).json({ message: "Invalid or expired Google token" });
    }
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
