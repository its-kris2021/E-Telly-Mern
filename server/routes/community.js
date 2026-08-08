import express from "express";
import mongoose from "mongoose";
import ResourceRequest  from "../models/ResourceRequest.js";
import ResourceDonation from "../models/ResourceDonation.js";
import ResourceMessage  from "../models/ResourceMessage.js";
import Alert            from "../models/Alert.js";
import User             from "../models/user.js";
import { protect, requireRole, requireAssignedBarangayIfOfficial, optionalProtect } from "../middleware/auth.js";
import { isOpsRole } from "../config/roles.js";
import { barangayLabel } from "../config/barangays.js";
import { sendAdminNotification, sendPushToUser } from "./push.js";

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ResourceRequest/ResourceDonation.barangay is free text (could be the
// normalized key "sanroque" or the display label "San Roque" depending on
// how the request was submitted) — match either, case-insensitively, same
// approach the /board handler already uses for its barangay query filter.
function barangayMatch(assignedBarangay) {
  const label = barangayLabel(assignedBarangay);
  return new RegExp(`^(${escapeRegex(assignedBarangay)}|${escapeRegex(label)})$`, "i");
}

// Mongo filter: {} for cdrrmo (city-wide), {barangay: <regex>} for barangay_official.
function communityBarangayFilter(req) {
  return req.user.role === "barangay_official"
    ? { barangay: barangayMatch(req.user.assignedBarangay) }
    : {};
}

// Write-path guard mirroring rejectIfOutsideAssignedBarangay, but using the
// same free-text-tolerant match as communityBarangayFilter.
function rejectIfCommunityOutsideAssignedBarangay(req, res, resourceBarangay) {
  if (req.user.role !== "barangay_official") return false;
  if (!barangayMatch(req.user.assignedBarangay).test(resourceBarangay ?? "")) {
    res.status(403).json({ success: false, error: "Outside your assigned barangay" });
    return true;
  }
  return false;
}

function anonymizeName(fullName) {
  if (!fullName) return "Anonymous";
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function isParticipant(request, userId, role) {
  if (isOpsRole(role)) return true;
  if (request.userId?.toString() === userId) return true;
  if (request.matchedPledgerId?.toString() === userId) return true;
  return false;
}

const router = express.Router();

// ─── Priority helper ──────────────────────────────────────────────────────────
const SEVERITY_SCORE = { evacuate: 4, critical: 3, warning: 2, watch: 1 };

function calcPriority(barangay, activeAlerts) {
  const lower = (barangay ?? "").toLowerCase();
  const matching = activeAlerts.filter((a) =>
    a.barangays.some((b) => b.toLowerCase() === lower),
  );
  if (!matching.length) return { level: "normal", score: 0 };

  const score = Math.max(...matching.map((a) => SEVERITY_SCORE[a.severity] ?? 0));
  let level = "medium";                  // warning (2) or watch (1)
  if (score >= 4) level = "critical";    // evacuate
  else if (score >= 3) level = "high";   // critical

  return { level, score };
}

// ─── Community Board (5.1) ────────────────────────────────────────────────────
router.get("/board", optionalProtect, async (req, res) => {
  try {
    const { barangay } = req.query;
    const requestFilter  = { status: { $in: ["open", "pending", "approved"] } };
    const donationFilter = { status: "offered" };
    if (barangay) {
      const re = new RegExp(`^${escapeRegex(barangay)}$`, "i");
      requestFilter.barangay  = re;
      donationFilter.barangay = re;
    }

    const [rawRequests, rawDonations, activeAlerts] = await Promise.all([
      ResourceRequest.find(requestFilter).sort({ createdAt: 1 }).lean(),
      ResourceDonation.find(donationFilter).sort({ createdAt: -1 }).lean(),
      Alert.find({ isActive: true }).select("barangays severity").lean(),
    ]);

    const requests = rawRequests.map((r) => {
      const { level, score } = calcPriority(r.barangay, activeAlerts);
      const pledgeCount = (r.pledges || []).filter((p) => p.status !== "withdrawn").length;
      return {
        _id: r._id,
        requesterName: anonymizeName(r.requesterName),
        barangay: r.barangay,
        address: r.address,
        gpsLat: r.gpsLat,
        gpsLng: r.gpsLng,
        category: r.category,
        itemDescription: r.itemDescription,
        quantity: r.quantity,
        unit: r.unit,
        urgent: r.urgent,
        status: r.status,
        pledgeCount,
        priority: level,
        createdAt: r.createdAt,
        _score: score,
      };
    });

    requests.sort((a, b) => b._score - a._score || new Date(a.createdAt) - new Date(b.createdAt));
    requests.forEach((r) => delete r._score);

    const donations = rawDonations.map((d) => ({
      _id: d._id,
      donorName: d.isAnonymous ? "Anonymous" : d.donorName,
      isOfficial: d.isOfficial || false,
      barangay: d.barangay,
      category: d.category,
      itemDescription: d.itemDescription,
      quantity: d.quantity,
      unit: d.unit,
      status: d.status,
      createdAt: d.createdAt,
    }));

    res.json({ success: true, requests, donations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Requests ─────────────────────────────────────────────────────────────────

// GET /api/community/requests — CDRRMO/Barangay Official view with priority scoring (5.4)
router.get("/requests", protect, requireRole("cdrrmo", "barangay_official"), requireAssignedBarangayIfOfficial, async (req, res) => {
  try {
    const [requests, activeAlerts] = await Promise.all([
      ResourceRequest.find(communityBarangayFilter(req)).sort({ createdAt: 1 }).lean(),
      Alert.find({ isActive: true }).select("barangays severity").lean(),
    ]);

    const withPriority = requests.map((r) => ({
      ...r,
      ...calcPriority(r.barangay, activeAlerts),
    }));

    withPriority.sort((a, b) => b.score - a.score || 0);

    res.json({ success: true, requests: withPriority });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/community/requests/mine (5.3)
router.get("/requests/mine", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("email").lean();
    if (!user) return res.status(404).json({ success: false, error: "User not found." });
    const requests = await ResourceRequest.find({
      $or: [{ requesterEmail: user.email }, { userId: req.user.id }],
    }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, requests });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/community/donations/mine (5.15)
router.get("/donations/mine", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("email").lean();
    if (!user) return res.status(404).json({ success: false, error: "User not found." });
    const donations = await ResourceDonation.find({
      $or: [{ donorEmail: user.email }, { userId: req.user.id }],
    }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, donations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/community/pledges/mine (5.14)
router.get("/pledges/mine", protect, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const requests = await ResourceRequest.find({
      pledges: { $elemMatch: { userId, status: { $ne: "withdrawn" } } },
    }).sort({ createdAt: -1 }).lean();

    const result = requests.map((r) => {
      const myPledge = r.pledges.find(
        (p) => p.userId.toString() === req.user.id && p.status !== "withdrawn",
      );
      return {
        ...r,
        myPledge: myPledge
          ? { status: myPledge.status, message: myPledge.message, createdAt: myPledge.createdAt }
          : null,
      };
    });

    res.json({ success: true, requests: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/community/requests (5.2)
router.post("/requests", optionalProtect, async (req, res) => {
  try {
    let {
      requesterName, requesterEmail, barangay, address, category,
      itemDescription, quantity, unit, reason,
      resourceId, resourceName, requestType, urgent, gpsLat, gpsLng, phone,
    } = req.body;

    if (req.user && (!requesterName || !requesterEmail)) {
      const profile = await User.findById(req.user.id).select("name email").lean();
      if (!profile) return res.status(404).json({ success: false, error: "User not found." });
      requesterName  = requesterName  || profile.name;
      requesterEmail = requesterEmail || profile.email;
    }

    if (!itemDescription && resourceName) itemDescription = resourceName;

    barangay = barangay || "unknown";
    address  = address  || "";
    category = category || "other";

    if (!requesterName || !requesterEmail || !itemDescription || !quantity) {
      return res.status(400).json({ success: false, error: "Missing required fields." });
    }

    const request = await ResourceRequest.create({
      requesterName, requesterEmail, barangay, address,
      category, itemDescription,
      quantity: Number(quantity),
      unit: unit || "pcs",
      reason: reason || "",
      status: "open",
      userId:      req.user ? req.user.id : null,
      resourceId:  resourceId  || null,
      requestType: requestType || "standard",
      urgent:      urgent      || false,
      gpsLat:      gpsLat      ?? null,
      gpsLng:      gpsLng      ?? null,
      phone:       phone        || null,
    });

    const io = req.app.get("io");
    if (io) io.emit("new_community_request", { request });

    sendAdminNotification({
      title: `New Resource Request — ${category}`,
      body: `${requesterName} from ${barangay} needs ${quantity} ${unit || "pcs"} of ${itemDescription}.`,
      url: "/community",
      tag: `request-${request._id}`,
      urgent: urgent || false,
    }).catch((err) => console.error("[Push] Request notification failed:", err));

    res.status(201).json({ success: true, request });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/community/requests/:id/pledge (5.6)
router.post("/requests/:id/pledge", protect, async (req, res) => {
  try {
    if (req.user.role !== "user") {
      return res.status(403).json({ success: false, error: "Only residents can pledge to help." });
    }

    const request = await ResourceRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, error: "Request not found." });

    if (request.userId?.toString() === req.user.id) {
      return res.status(403).json({ success: false, error: "You cannot pledge on your own request." });
    }

    if (!["open", "pending", "approved"].includes(request.status)) {
      return res.status(400).json({ success: false, error: "This request is not accepting pledges." });
    }

    const alreadyPledged = request.pledges.find(
      (p) => p.userId.toString() === req.user.id && p.status !== "withdrawn",
    );
    if (alreadyPledged) {
      return res.status(409).json({ success: false, error: "You already have an active pledge on this request." });
    }

    const { message, phone, pledgerLat, pledgerLng } = req.body;
    const profile = await User.findById(req.user.id).select("name barangay").lean();
    const pledgerName = profile?.name || req.user.name || "Unknown";

    request.pledges.push({
      userId: req.user.id,
      name: pledgerName,
      phone: phone || null,
      message: message || "",
      pledgerLat: pledgerLat ?? null,
      pledgerLng: pledgerLng ?? null,
      pledgerBarangay: profile?.barangay || null,
    });
    await request.save();

    const pledgeCount = request.pledges.filter((p) => p.status !== "withdrawn").length;

    const io = req.app.get("io");
    if (io) {
      io.to(`user-${request.userId}`).emit("new_pledge", { requestId: request._id, pledgerName });
      io.to("admin-room").emit("new_pledge", { requestId: request._id, pledgerName });
    }

    if (request.userId) {
      sendPushToUser(request.userId, {
        title: "Someone offered to help!",
        body: `${pledgerName} can help with your ${request.itemDescription} request. Tap to review.`,
        url: "/community",
        tag: `pledge-${request._id}`,
        urgent: false,
      }).catch(() => {});
    }

    res.status(201).json({ success: true, pledgeCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/community/requests/:id/pledge (5.7)
router.delete("/requests/:id/pledge", protect, async (req, res) => {
  try {
    const request = await ResourceRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, error: "Request not found." });

    const pledgeIdx = request.pledges.findIndex(
      (p) => p.userId.toString() === req.user.id && p.status !== "withdrawn",
    );
    if (pledgeIdx === -1) {
      return res.status(404).json({ success: false, error: "No active pledge from you on this request." });
    }
    if (request.pledges[pledgeIdx].status === "accepted") {
      return res.status(400).json({ success: false, error: "Cannot withdraw an accepted pledge. Contact CDRRMO." });
    }

    request.pledges[pledgeIdx].status = "withdrawn";
    await request.save();

    const io = req.app.get("io");
    if (io) io.emit("community_request_updated", { id: request._id, status: request.status });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/community/requests/:id/accept-pledge (5.8)
router.patch("/requests/:id/accept-pledge", protect, async (req, res) => {
  try {
    const { pledgeId } = req.body;
    if (!pledgeId) return res.status(400).json({ success: false, error: "pledgeId is required." });

    // Read first for ownership/validation and to capture the pledger's immutable
    // identity (userId, name). The actual state change is applied atomically below.
    const existing = await ResourceRequest.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: "Request not found." });

    if (existing.userId?.toString() !== req.user.id) {
      return res.status(403).json({ success: false, error: "Only the requester can accept a pledge." });
    }
    if (!["open", "pending", "approved"].includes(existing.status)) {
      return res.status(400).json({ success: false, error: "This request is not in open status." });
    }

    const chosenPledge = existing.pledges.id(pledgeId);
    if (!chosenPledge) return res.status(404).json({ success: false, error: "Pledge not found." });
    if (chosenPledge.status === "withdrawn") {
      return res.status(400).json({ success: false, error: "The chosen pledge has been withdrawn." });
    }
    if (chosenPledge.status !== "pending") {
      return res.status(400).json({ success: false, error: "This pledge is no longer pending." });
    }

    // Atomic claim: only succeeds if the request is still open and the chosen
    // pledge is still pending. A concurrent accept on the same request will find
    // the status already "matched" and fail the filter, returning null.
    const request = await ResourceRequest.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.user.id,
        status: { $in: ["open", "pending", "approved"] },
        pledges: { $elemMatch: { _id: pledgeId, status: "pending" } },
      },
      {
        $set: {
          "pledges.$.status": "accepted",
          matchedPledgerId: chosenPledge.userId,
          status: "matched",
        },
        $push: {
          actionLog: {
            action: "matched",
            by: req.user.name,
            byId: req.user.id,
            note: `Pledge accepted from ${chosenPledge.name}`,
          },
        },
      },
      { new: true },
    );
    if (!request) {
      return res.status(409).json({
        success: false,
        error: "This request was just matched or is no longer accepting pledges.",
      });
    }

    // Decline the remaining pending pledges in a single targeted update.
    const otherPendingIds = request.pledges
      .filter((p) => p._id.toString() !== pledgeId && p.status === "pending")
      .map((p) => p._id);
    const declinedPledgers = request.pledges.filter((p) =>
      otherPendingIds.some((id) => id.equals(p._id)),
    );
    if (otherPendingIds.length) {
      await ResourceRequest.updateOne(
        { _id: request._id },
        { $set: { "pledges.$[d].status": "declined" } },
        { arrayFilters: [{ "d._id": { $in: otherPendingIds } }] },
      );
    }

    const io = req.app.get("io");
    if (io) {
      io.to(`user-${chosenPledge.userId}`).emit("pledge_accepted", {
        requestId: request._id,
        message: "Your offer was accepted! Check the chat to coordinate.",
      });
      for (const p of declinedPledgers) {
        io.to(`user-${p.userId}`).emit("pledge_declined", { requestId: request._id });
      }
      io.emit("community_request_updated", { id: request._id, status: request.status });
    }

    sendPushToUser(chosenPledge.userId, {
      title: "Your offer was accepted!",
      body: `Coordinate with ${request.requesterName} in the chat to arrange delivery.`,
      url: "/community",
      tag: `message-${request._id}`,
      urgent: false,
    }).catch(() => {});

    for (const p of declinedPledgers) {
      sendPushToUser(p.userId, {
        title: "Thank you for offering",
        body: "Another helper was chosen for this request.",
        url: "/community",
        tag: `declined-${request._id}`,
        urgent: false,
      }).catch(() => {});
    }

    res.json({ success: true, request });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/community/requests/:id/release — revert a matched request to open
// when the assigned helper backs out. Requester or CDRRMO only; blocked once the
// helper has marked delivery, to avoid losing an in-progress hand-off.
router.patch("/requests/:id/release", protect, async (req, res) => {
  try {
    const { note } = req.body;
    const existing = await ResourceRequest.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: "Request not found." });

    const isOwner = existing.userId?.toString() === req.user.id;
    const isAdmin = isOpsRole(req.user.role);
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, error: "Only the requester or CDRRMO can release this match." });
    }
    if (existing.status !== "matched") {
      return res.status(400).json({ success: false, error: "Only a matched request can be released." });
    }
    if (existing.deliveredAt) {
      return res.status(400).json({ success: false, error: "Cannot release — the helper already marked this delivered. Confirm receipt or contact CDRRMO." });
    }

    const releasedPledgerId = existing.matchedPledgerId;

    // Atomic guard: only release if still matched and not yet delivered.
    const request = await ResourceRequest.findOneAndUpdate(
      { _id: req.params.id, status: "matched", deliveredAt: null },
      {
        $set: { status: "open", matchedPledgerId: null, "pledges.$[acc].status": "withdrawn" },
        $push: { actionLog: { action: "released", by: req.user.name, byId: req.user.id, note: note || "" } },
      },
      { arrayFilters: [{ "acc.status": "accepted" }], new: true },
    );
    if (!request) {
      return res.status(409).json({ success: false, error: "This request is no longer in a matched state." });
    }

    const io = req.app.get("io");
    if (io) {
      io.emit("community_request_updated", { id: request._id, status: request.status });
      if (releasedPledgerId) io.to(`user-${releasedPledgerId}`).emit("pledge_declined", { requestId: request._id });
    }

    if (releasedPledgerId) {
      sendPushToUser(releasedPledgerId, {
        title: "Match released",
        body: `Your match for "${request.itemDescription}" was released. The request is open again.`,
        url: "/community",
        tag: `released-${request._id}`,
        urgent: false,
      }).catch(() => {});
    }

    res.json({ success: true, request });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/community/requests/:id/deliver (5.9)
router.patch("/requests/:id/deliver", protect, async (req, res) => {
  try {
    const request = await ResourceRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, error: "Request not found." });

    if (request.matchedPledgerId?.toString() !== req.user.id) {
      return res.status(403).json({ success: false, error: "Only the assigned helper can mark this delivered." });
    }
    if (request.status !== "matched") {
      return res.status(400).json({ success: false, error: "Request is not in matched status." });
    }
    if (request.deliveredAt) {
      return res.status(400).json({ success: false, error: "Already marked as delivered." });
    }

    request.deliveredAt = new Date();
    await request.save();

    const io = req.app.get("io");
    if (io) io.to(`user-${request.userId}`).emit("request_delivered", { requestId: request._id });

    if (request.userId) {
      const helperName = req.user.name || "Your helper";
      sendPushToUser(request.userId, {
        title: `${helperName} says delivered!`,
        body: `Please confirm you received your ${request.itemDescription}.`,
        url: "/community",
        tag: `delivered-${request._id}`,
        urgent: false,
      }).catch(() => {});
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/community/requests/:id/confirm (5.10)
router.patch("/requests/:id/confirm", protect, async (req, res) => {
  try {
    const { note } = req.body;
    const request = await ResourceRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, error: "Request not found." });

    const isOwner = request.userId?.toString() === req.user.id;
    const isAdmin = isOpsRole(req.user.role);
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, error: "Only the requester or admin can confirm receipt." });
    }
    if (request.status !== "matched") {
      return res.status(400).json({ success: false, error: "Request must be in matched status to confirm." });
    }

    request.status = "fulfilled";
    request.actionLog.push({ action: "fulfilled", by: req.user.name, byId: req.user.id, note: note || "" });
    await request.save();

    const io = req.app.get("io");
    if (io) io.emit("community_request_updated", { id: request._id, status: request.status });

    if (request.matchedPledgerId) {
      sendPushToUser(request.matchedPledgerId, {
        title: "Request fulfilled!",
        body: `Your delivery was confirmed! Thank you for helping.`,
        url: "/community",
        tag: `fulfilled-${request._id}`,
        urgent: false,
      }).catch(() => {});
    }

    res.json({ success: true, request });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/community/requests/:id/fulfill — admin force-fulfill (5.11)
router.patch("/requests/:id/fulfill", protect, requireRole("cdrrmo", "barangay_official"), async (req, res) => {
  try {
    const { note } = req.body;
    const request = await ResourceRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, error: "Request not found." });
    if (rejectIfCommunityOutsideAssignedBarangay(req, res, request.barangay)) return;
    if (!["open", "pending", "approved", "matched"].includes(request.status)) {
      return res.status(400).json({ success: false, error: "Cannot force-fulfill a request in its current state." });
    }

    request.status = "fulfilled";
    request.actionLog.push({ action: "fulfilled", by: req.user.name, byId: req.user.id, note: note || "" });
    await request.save();

    const io = req.app.get("io");
    if (io) io.emit("community_request_updated", { id: request._id, status: request.status });

    res.json({ success: true, request });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/community/requests/:id/cancel (5.5)
router.patch("/requests/:id/cancel", protect, async (req, res) => {
  try {
    const { note } = req.body;
    const request = await ResourceRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, error: "Request not found." });

    const isOwner = request.userId?.toString() === req.user.id;
    const isAdmin = isOpsRole(req.user.role);
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, error: "You do not have permission to cancel this request." });
    }
    if (["fulfilled", "cancelled"].includes(request.status)) {
      return res.status(400).json({ success: false, error: "Cannot cancel a request that is already fulfilled or cancelled." });
    }

    request.status = "cancelled";
    request.actionLog.push({ action: "cancelled", by: req.user.name, byId: req.user.id, note: note || "" });
    await request.save();

    const io = req.app.get("io");
    if (io) io.emit("community_request_updated", { id: request._id, status: request.status });

    res.json({ success: true, request });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/community/requests/:id/messages (5.12)
router.get("/requests/:id/messages", protect, async (req, res) => {
  try {
    const request = await ResourceRequest.findById(req.params.id).lean();
    if (!request) return res.status(404).json({ success: false, error: "Request not found." });
    if (!isParticipant(request, req.user.id, req.user.role)) {
      return res.status(403).json({ success: false, error: "You are not a participant in this request." });
    }

    const messages = await ResourceMessage.find({ requestId: req.params.id })
      .sort({ createdAt: 1 })
      .lean();
    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/community/requests/:id/messages (5.13)
router.post("/requests/:id/messages", protect, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ success: false, error: "Message text is required." });
    if (text.length > 1000) return res.status(400).json({ success: false, error: "Message too long (max 1000 characters)." });

    const request = await ResourceRequest.findById(req.params.id).lean();
    if (!request) return res.status(404).json({ success: false, error: "Request not found." });
    if (!isParticipant(request, req.user.id, req.user.role)) {
      return res.status(403).json({ success: false, error: "You are not a participant in this request." });
    }
    if (request.status !== "matched") {
      return res.status(400).json({ success: false, error: "Messages can only be sent on matched requests." });
    }

    const senderRole = isOpsRole(req.user.role) ? req.user.role : "resident";
    const message = await ResourceMessage.create({
      requestId: req.params.id,
      senderId:   req.user.id,
      senderName: req.user.name,
      senderRole,
      text: text.trim(),
    });

    const io = req.app.get("io");
    if (io) io.to(`request-${req.params.id}`).emit("new_message", { message });

    // Notify the other participant(s)
    const truncated = text.length > 60 ? text.slice(0, 57) + "..." : text;
    const isRequester  = request.userId?.toString() === req.user.id;
    const isPledger    = request.matchedPledgerId?.toString() === req.user.id;
    const isAdminSend  = isOpsRole(req.user.role);

    if (isAdminSend) {
      if (request.userId) {
        sendPushToUser(request.userId, {
          title: `New message from ${req.user.name}`,
          body: truncated,
          url: "/community",
          tag: `message-${request._id}`,
          urgent: false,
        }).catch(() => {});
      }
      if (request.matchedPledgerId) {
        sendPushToUser(request.matchedPledgerId, {
          title: `New message from ${req.user.name}`,
          body: truncated,
          url: "/community",
          tag: `message-${request._id}`,
          urgent: false,
        }).catch(() => {});
      }
    } else if (isRequester && request.matchedPledgerId) {
      sendPushToUser(request.matchedPledgerId, {
        title: `New message from ${req.user.name}`,
        body: truncated,
        url: "/community",
        tag: `message-${request._id}`,
        urgent: false,
      }).catch(() => {});
    } else if (isPledger && request.userId) {
      sendPushToUser(request.userId, {
        title: `New message from ${req.user.name}`,
        body: truncated,
        url: "/community",
        tag: `message-${request._id}`,
        urgent: false,
      }).catch(() => {});
    }

    res.status(201).json({ success: true, message });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Donations ────────────────────────────────────────────────────────────────

// GET /api/community/donations
router.get("/donations", protect, async (req, res) => {
  try {
    const donations = await ResourceDonation.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, donations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/community/donations (5.16 — isOfficial field added)
router.post("/donations", optionalProtect, async (req, res) => {
  try {
    let {
      donorName, donorEmail, barangay, category, itemDescription, quantity, unit,
      resourceId, resourceName, phone, dob, gpsLat, gpsLng, pickupAddress, isAnonymous,
      isOfficial,
    } = req.body;

    if (isOfficial && (!req.user || !isOpsRole(req.user.role))) {
      return res.status(403).json({ success: false, error: "Only CDRRMO staff can post official supply offers." });
    }

    if (req.user && (!donorName || !donorEmail)) {
      if (isAnonymous) {
        donorName  = "Anonymous";
        donorEmail = `anonymous+${req.user.id}@etelly.local`;
      } else {
        const profile = await User.findById(req.user.id).select("name email address").lean();
        if (!profile) return res.status(404).json({ success: false, error: "User not found." });
        donorName     = donorName     || profile.name;
        donorEmail    = donorEmail    || profile.email;
        pickupAddress = pickupAddress || profile.address || null;
      }
    }

    if (!itemDescription && resourceName) itemDescription = resourceName;

    barangay = barangay || "unknown";
    category = category || "other";

    if (!donorName || !donorEmail || !itemDescription || !quantity) {
      return res.status(400).json({ success: false, error: "Missing required fields." });
    }

    const donation = await ResourceDonation.create({
      donorName, donorEmail, barangay,
      category, itemDescription,
      quantity: Number(quantity),
      unit: unit || "pcs",
      userId:        req.user ? req.user.id : null,
      resourceId:    resourceId    || null,
      phone:         phone         || null,
      dob:           dob           || null,
      gpsLat:        gpsLat        ?? null,
      gpsLng:        gpsLng        ?? null,
      pickupAddress: pickupAddress || null,
      isAnonymous:   isAnonymous   || false,
      isOfficial:    !!isOfficial,
    });

    const io = req.app.get("io");
    if (io) io.emit("new_community_donation", { donation });

    sendAdminNotification({
      title: `New Donation Offer — ${category}`,
      body: `${isAnonymous ? "Anonymous donor" : donorName} from ${barangay} is offering ${quantity} ${unit || "pcs"} of ${itemDescription}.`,
      url: "/community",
      tag: `donation-${donation._id}`,
      urgent: false,
    }).catch((err) => console.error("[Push] Donation notification failed:", err));

    res.status(201).json({ success: true, donation });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/community/donations/:id/schedule (5.17 — matchedRequestId field added)
router.patch("/donations/:id/schedule", protect, requireRole("cdrrmo", "barangay_official"), async (req, res) => {
  try {
    const { scheduledWindow, note, matchedRequestId } = req.body;

    const donation = await ResourceDonation.findById(req.params.id);
    if (!donation) return res.status(404).json({ success: false, error: "Donation not found." });
    if (rejectIfCommunityOutsideAssignedBarangay(req, res, donation.barangay)) return;
    if (donation.status !== "offered") return res.status(400).json({ success: false, error: "Only offered donations can be scheduled." });

    if (matchedRequestId) {
      if (!mongoose.Types.ObjectId.isValid(matchedRequestId)) {
        return res.status(400).json({ success: false, error: "Invalid matchedRequestId." });
      }
      const linkedRequest = await ResourceRequest.findById(matchedRequestId).lean();
      if (!linkedRequest) {
        return res.status(400).json({ success: false, error: "Linked request not found." });
      }
      if (!["open", "pending", "approved", "matched"].includes(linkedRequest.status)) {
        return res.status(400).json({ success: false, error: "Linked request is not in a valid status." });
      }
      donation.matchedRequestId = matchedRequestId;
    }

    donation.status = "scheduled";
    donation.dropOffPoint = donation.barangay;
    donation.scheduledWindow = scheduledWindow || "";
    donation.actionLog.push({ action: "scheduled", by: req.user.name, byId: req.user.id, note: note || "" });
    await donation.save();

    const io = req.app.get("io");
    if (io) io.emit("community_donation_updated", { id: donation._id, status: donation.status });

    res.json({ success: true, donation });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/community/donations/:id/receive (5.18 — unchanged)
router.patch("/donations/:id/receive", protect, requireRole("cdrrmo", "barangay_official"), async (req, res) => {
  try {
    const { note } = req.body;
    const donation = await ResourceDonation.findById(req.params.id);
    if (!donation) return res.status(404).json({ success: false, error: "Donation not found." });
    if (rejectIfCommunityOutsideAssignedBarangay(req, res, donation.barangay)) return;
    if (donation.status !== "scheduled") return res.status(400).json({ success: false, error: "Only scheduled donations can be marked received." });

    donation.status = "received";
    donation.actionLog.push({ action: "received", by: req.user.name, byId: req.user.id, note: note || "" });
    await donation.save();

    const io = req.app.get("io");
    if (io) io.emit("community_donation_updated", { id: donation._id, status: donation.status });

    res.json({ success: true, donation });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/community/donations/:id/cancel — donor or CDRRMO/Barangay Official only
router.patch("/donations/:id/cancel", protect, async (req, res) => {
  try {
    const { note } = req.body;
    const donation = await ResourceDonation.findById(req.params.id);
    if (!donation) return res.status(404).json({ success: false, error: "Donation not found." });

    const isOwner = donation.userId?.toString() === req.user.id;
    const isAdmin = isOpsRole(req.user.role);
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, error: "You do not have permission to cancel this donation." });
    }
    if (rejectIfCommunityOutsideAssignedBarangay(req, res, donation.barangay)) return;
    if (["received", "cancelled"].includes(donation.status)) {
      return res.status(400).json({ success: false, error: "Cannot cancel a donation that is already received or cancelled." });
    }

    donation.status = "cancelled";
    donation.actionLog.push({ action: "cancelled", by: req.user.name, byId: req.user.id, note: note || "" });
    await donation.save();

    const io = req.app.get("io");
    if (io) io.emit("community_donation_updated", { id: donation._id, status: donation.status });

    res.json({ success: true, donation });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Chat Monitoring (CDRRMO oversight of ResourceMessage threads) ────────────

// GET /api/community/messages — city-wide, paginated list of chat threads
// across all resource requests, for CDRRMO oversight. Not barangay-scoped:
// CDRRMO monitoring is city-wide by design.
router.get("/messages", protect, requireRole("cdrrmo"), async (req, res) => {
  try {
    const { limit = 50, before } = req.query;
    const query = before ? { createdAt: { $lt: new Date(before) } } : {};
    const messages = await ResourceMessage.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit, 10) || 50, 200))
      .lean();

    const requestIds = [...new Set(messages.map((m) => m.requestId.toString()))];
    const requests = await ResourceRequest.find({ _id: { $in: requestIds } })
      .select("itemDescription barangay requesterName status")
      .lean();
    const requestById = Object.fromEntries(requests.map((r) => [r._id.toString(), r]));

    res.json({
      success: true,
      messages: messages.map((m) => ({ ...m, request: requestById[m.requestId.toString()] ?? null })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
