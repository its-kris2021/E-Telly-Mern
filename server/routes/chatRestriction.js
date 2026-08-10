import express from "express";
import { protect } from "../middleware/auth.js";
import { getRestrictionStatus } from "../services/chatRestrictionService.js";

const router = express.Router();

// GET /api/chat-restriction/status — any authenticated user checks their own
// current chat-restriction state. This is the enforcement hook any chat
// client (the mobile app, or a future web chat UI) must call before letting
// someone send: it survives refresh/logout-login/a new chat request because
// it's derived fresh from the server-side moderation profile every call, not
// cached client-side. Expiry is applied lazily here too, so a temporary
// restriction that has lapsed clears itself on the very next check with no
// admin action needed.
router.get("/status", protect, async (req, res) => {
  try {
    const status = await getRestrictionStatus(req.user.id);
    res.json({ success: true, ...status });
  } catch (err) {
    console.error("[ChatRestriction] status check failed:", err.message);
    res.status(500).json({ message: "Failed to load restriction status" });
  }
});

export default router;
