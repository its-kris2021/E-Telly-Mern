import express from "express";
import mongoose from "mongoose";
import { randomBytes } from "crypto";
import User from "../models/user.js";
import Family from "../models/Family.js";
import FamilyInvite from "../models/FamilyInvite.js";
import { protect, requireRole, requireAssignedBarangayIfOfficial } from "../middleware/auth.js";
import { sendFamilyInviteEmail } from "../services/mailer.js";
import { resolveBarangayKey, barangayLabel } from "../config/barangays.js";

const router = express.Router();

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function newExpiry() {
  return new Date(Date.now() + INVITE_TTL_MS);
}

// JWT payload only carries {id, name, role} — no email — so every handler
// that needs the caller's own email loads the User doc first.
async function loadCaller(req, res) {
  const caller = await User.findById(req.user.id);
  if (!caller) {
    res.status(404).json({ message: "User not found" });
    return null;
  }
  return caller;
}

// ── POST /api/family/invite ───────────────────────────────────────────────
router.post("/invite", protect, async (req, res) => {
  const { email, relationship } = req.body;

  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) {
    return res.status(400).json({ message: "Email is required." });
  }
  if (!relationship?.trim()) {
    return res.status(400).json({ message: "Relationship is required." });
  }

  try {
    const caller = await loadCaller(req, res);
    if (!caller) return;

    if (normalizedEmail === caller.email.toLowerCase()) {
      return res.status(400).json({ message: "You can't invite yourself." });
    }

    let family = await Family.findOne({ owner: caller._id });
    if (!family) {
      family = await Family.create({ owner: caller._id, members: [] });
    }

    const invitedUser = await User.findOne({ email: normalizedEmail });
    if (invitedUser && family.members.some((m) => String(m.user) === String(invitedUser._id))) {
      return res.status(409).json({ message: "This person is already a family member." });
    }

    let invite = await FamilyInvite.findOne({
      family: family._id,
      inviteeEmail: normalizedEmail,
      status: "pending",
    });

    if (invite) {
      invite.relationship = relationship.trim();
      invite.token = randomBytes(32).toString("hex");
      invite.expiresAt = newExpiry();
      await invite.save();
    } else {
      invite = await FamilyInvite.create({
        family: family._id,
        inviter: caller._id,
        inviteeEmail: normalizedEmail,
        relationship: relationship.trim(),
        token: randomBytes(32).toString("hex"),
        expiresAt: newExpiry(),
      });
    }

    try {
      await sendFamilyInviteEmail({
        to: normalizedEmail,
        inviterName: caller.name,
        relationship: invite.relationship,
      });
    } catch (err) {
      console.error("[Family] Failed to send invite email:", err.message);
    }

    res.status(201).json({
      message: "Invite sent.",
      invite: {
        id: invite._id,
        inviteeEmail: invite.inviteeEmail,
        relationship: invite.relationship,
        status: invite.status,
        expiresAt: invite.expiresAt,
      },
    });
  } catch (err) {
    console.error("[Family] Invite error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

// ── GET /api/family/invites/pending ───────────────────────────────────────
// Invites addressed to the caller (as invitee).
router.get("/invites/pending", protect, async (req, res) => {
  try {
    const caller = await loadCaller(req, res);
    if (!caller) return;

    const invites = await FamilyInvite.find({
      inviteeEmail: caller.email.toLowerCase(),
      status: "pending",
      expiresAt: { $gt: new Date() },
    })
      .populate("inviter", "name email")
      .sort({ createdAt: -1 });

    res.json({
      invites: invites.map((inv) => ({
        id: inv._id,
        relationship: inv.relationship,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
        inviter: { name: inv.inviter?.name || "", email: inv.inviter?.email || "" },
      })),
    });
  } catch (err) {
    console.error("[Family] Pending invites error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

// ── GET /api/family/invites/sent ──────────────────────────────────────────
// Invites the caller has sent (as owner of their own family).
router.get("/invites/sent", protect, async (req, res) => {
  try {
    const caller = await loadCaller(req, res);
    if (!caller) return;

    const family = await Family.findOne({ owner: caller._id });
    if (!family) return res.json({ invites: [] });

    const invites = await FamilyInvite.find({ family: family._id }).sort({ createdAt: -1 });

    res.json({
      invites: invites.map((inv) => ({
        id: inv._id,
        inviteeEmail: inv.inviteeEmail,
        relationship: inv.relationship,
        status: inv.status,
        expiresAt: inv.expiresAt,
        respondedAt: inv.respondedAt,
        createdAt: inv.createdAt,
      })),
    });
  } catch (err) {
    console.error("[Family] Sent invites error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

// ── POST /api/family/invites/:id/accept ───────────────────────────────────
router.post("/invites/:id/accept", protect, async (req, res) => {
  try {
    const caller = await loadCaller(req, res);
    if (!caller) return;

    const invite = mongoose.isValidObjectId(req.params.id)
      ? await FamilyInvite.findById(req.params.id)
      : null;
    if (!invite) return res.status(404).json({ message: "Invite not found." });

    if (invite.status !== "pending") {
      return res.status(409).json({ message: "This invite is no longer pending." });
    }

    if (invite.expiresAt < new Date()) {
      invite.status = "expired";
      await invite.save();
      return res.status(410).json({ message: "This invite has expired." });
    }

    // Core consent check: email ownership alone is not proof of consent —
    // the authenticated account's email must match who the invite was sent to.
    if (invite.inviteeEmail !== caller.email.toLowerCase()) {
      return res.status(403).json({ message: "This invite was not sent to your account." });
    }

    const family = await Family.findById(invite.family);
    if (!family) return res.status(404).json({ message: "Family not found." });

    const alreadyMember = family.members.some((m) => String(m.user) === String(caller._id));
    if (!alreadyMember) {
      family.members.push({
        user: caller._id,
        relationship: invite.relationship,
        addedAt: new Date(),
      });
      await family.save();
    }

    invite.status = "accepted";
    invite.respondedAt = new Date();
    await invite.save();

    res.json({ message: "You've joined the family." });
  } catch (err) {
    console.error("[Family] Accept invite error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

// ── POST /api/family/invites/:id/decline ──────────────────────────────────
router.post("/invites/:id/decline", protect, async (req, res) => {
  try {
    const caller = await loadCaller(req, res);
    if (!caller) return;

    const invite = mongoose.isValidObjectId(req.params.id)
      ? await FamilyInvite.findById(req.params.id)
      : null;
    if (!invite) return res.status(404).json({ message: "Invite not found." });

    if (invite.status !== "pending") {
      return res.status(409).json({ message: "This invite is no longer pending." });
    }

    if (invite.inviteeEmail !== caller.email.toLowerCase()) {
      return res.status(403).json({ message: "This invite was not sent to your account." });
    }

    invite.status = "declined";
    invite.respondedAt = new Date();
    await invite.save();

    res.json({ message: "Invite declined." });
  } catch (err) {
    console.error("[Family] Decline invite error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

// ── DELETE /api/family/invites/:id ────────────────────────────────────────
// Inviter cancels a pending invite they sent.
router.delete("/invites/:id", protect, async (req, res) => {
  try {
    const caller = await loadCaller(req, res);
    if (!caller) return;

    const invite = mongoose.isValidObjectId(req.params.id)
      ? await FamilyInvite.findById(req.params.id)
      : null;
    if (!invite) return res.status(404).json({ message: "Invite not found." });

    if (String(invite.inviter) !== String(caller._id)) {
      return res.status(403).json({ message: "You can only cancel invites you sent." });
    }
    if (invite.status !== "pending") {
      return res.status(409).json({ message: "This invite is no longer pending." });
    }

    invite.status = "cancelled";
    invite.respondedAt = new Date();
    await invite.save();

    res.json({ message: "Invite cancelled." });
  } catch (err) {
    console.error("[Family] Cancel invite error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

// ── GET /api/family ────────────────────────────────────────────────────────
// The family the caller owns, plus any families the caller belongs to.
router.get("/", protect, async (req, res) => {
  try {
    const caller = await loadCaller(req, res);
    if (!caller) return;

    const owned = await Family.findOne({ owner: caller._id }).populate(
      "members.user",
      "name email",
    );

    const memberOf = await Family.find({ "members.user": caller._id }).populate(
      "owner",
      "name email",
    );

    res.json({
      owned: owned
        ? {
            id: owned._id,
            members: owned.members.map((m) => ({
              userId: m.user._id,
              name: m.user.name,
              email: m.user.email,
              relationship: m.relationship,
              addedAt: m.addedAt,
            })),
          }
        : null,
      memberOf: memberOf.map((fam) => {
        const membership = fam.members.find((m) => String(m.user) === String(caller._id));
        return {
          familyId: fam._id,
          ownerName: fam.owner?.name || "",
          ownerEmail: fam.owner?.email || "",
          relationship: membership?.relationship || "",
          joinedAt: membership?.addedAt || null,
        };
      }),
    });
  } catch (err) {
    console.error("[Family] Get family error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

// ── DELETE /api/family/members/:userId ────────────────────────────────────
router.delete("/members/:userId", protect, async (req, res) => {
  try {
    const caller = await loadCaller(req, res);
    if (!caller) return;

    const family = await Family.findOne({ owner: caller._id });
    if (!family) return res.status(404).json({ message: "Family not found." });

    family.members = family.members.filter(
      (m) => String(m.user) !== String(req.params.userId),
    );
    await family.save();

    res.json({ message: "Family member removed." });
  } catch (err) {
    console.error("[Family] Remove member error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

// ── GET /api/family/barangay-roster ───────────────────────────────────────
// Barangay Official view: every resident whose profile address resolves to
// their assigned barangay, plus each resident's confirmed family members.
// Residents have no structured barangay field (only free-text `address`),
// so this reuses the same resolveBarangayKey() heuristic already used to
// scope emergency reports — best-effort, not a hard guarantee of accuracy.
router.get("/barangay-roster", protect, requireRole("barangay_official"), requireAssignedBarangayIfOfficial, async (req, res) => {
  try {
    const residents = await User.find({ role: "user" }).select("name email address").lean();

    const inBarangay = residents.filter(
      (r) => resolveBarangayKey(r.address) === req.user.assignedBarangay,
    );

    const families = await Family.find({ owner: { $in: inBarangay.map((r) => r._id) } })
      .populate("members.user", "name email")
      .lean();
    const familyByOwner = Object.fromEntries(families.map((f) => [String(f.owner), f]));

    const roster = inBarangay.map((r) => {
      const family = familyByOwner[String(r._id)];
      return {
        residentId: r._id,
        name: r.name,
        email: r.email,
        address: r.address,
        familyMembers: (family?.members ?? []).map((m) => ({
          name: m.user?.name || "",
          email: m.user?.email || "",
          relationship: m.relationship,
        })),
      };
    });

    res.json({
      success: true,
      barangay: req.user.assignedBarangay,
      barangayLabel: barangayLabel(req.user.assignedBarangay),
      residents: roster,
    });
  } catch (err) {
    console.error("[Family] Barangay roster error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
