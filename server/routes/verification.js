import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { protect, requireRole } from "../middleware/auth.js";
import VerificationRequest, {
  VERIFICATION_STATUSES,
  DOCUMENT_TYPES,
} from "../models/VerificationRequest.js";
import User from "../models/user.js";
import { sendPushToUser } from "./push.js";

const router = express.Router();
const isLocalMode = process.env.LOCAL_MODE === "true";

if (!isLocalMode) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

// Every route here requires a logged-in user; admin-only routes additionally
// gate with requireRole("system_admin") below. Residency verification is an
// account-eligibility concern (not disaster-ops), so review stays with
// system_admin only — unlike chat-monitoring/reports there's no barangay
// scoping middleware needed here.
router.use(protect);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    // application/octet-stream occurs when mobile sends XFile with null mimeType
    if (file.mimetype.startsWith("image/") || file.mimetype === "application/octet-stream") {
      cb(null, true);
    } else {
      cb(Object.assign(new Error("Only image files are accepted"), { status: 400 }));
    }
  },
});

function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "etelly/resident-verification", resource_type: "image", format: "jpg", quality: "auto" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}

function requestSummary(doc) {
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    userEmail: doc.userEmail,
    userName: doc.userName,
    declaredBarangay: doc.declaredBarangay,
    declaredCity: doc.declaredCity,
    documentType: doc.documentType,
    documentUrls: doc.documentUrls,
    status: doc.status,
    adminNotes: doc.adminNotes,
    reviewedBy: doc.reviewedBy,
    reviewedAt: doc.reviewedAt,
    logs: doc.logs,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// POST /api/verification/upload-document
// Accepts up to 5 images as multipart/form-data field "images"
// Returns { success, urls, failed }
router.post("/upload-document", (req, res, next) => {
  upload.array("images", 5)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const msg =
        err.code === "LIMIT_FILE_COUNT"
          ? "Maximum 5 images per request"
          : err.code === "LIMIT_FILE_SIZE"
          ? "Each image must be under 5MB"
          : err.message;
      return res.status(400).json({ success: false, error: msg, urls: [], failed: 0 });
    }
    if (err) {
      return res.status(err.status || 400).json({ success: false, error: err.message, urls: [], failed: 0 });
    }
    next();
  });
}, async (req, res) => {
  const files = req.files ?? [];
  if (files.length === 0) {
    return res.status(400).json({ success: false, error: "No images provided", urls: [], failed: 0 });
  }

  const results = await Promise.allSettled(files.map((file) => uploadToCloudinary(file.buffer)));
  const urls = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const failed = results.filter((r) => r.status === "rejected").length;

  if (urls.length === 0) {
    return res.status(500).json({ success: false, error: "All document uploads failed", urls: [], failed });
  }

  res.json({ success: true, urls, failed });
});

// POST /api/verification/requests — resident submits a new request.
router.post("/requests", async (req, res) => {
  try {
    const { documentType, documentUrls, declaredBarangay } = req.body;

    if (!DOCUMENT_TYPES.includes(documentType)) {
      return res.status(400).json({ message: "Invalid document type" });
    }
    if (!Array.isArray(documentUrls) || documentUrls.length === 0) {
      return res.status(400).json({ message: "At least one document photo is required" });
    }

    const existingPending = await VerificationRequest.findOne({
      userId: req.user.id,
      status: "pending",
    });
    if (existingPending) {
      return res.status(400).json({ message: "You already have a pending verification request" });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const doc = await VerificationRequest.create({
      userId: user._id,
      userEmail: user.email,
      userName: user.name,
      declaredBarangay: declaredBarangay || user.barangay || "",
      documentType,
      documentUrls,
      logs: [
        {
          action: "submitted",
          byId: user._id,
          byName: user.name,
          byRole: user.role,
          notes: "",
        },
      ],
    });

    user.residencyStatus = "pending";
    await user.save();

    res.status(201).json({ success: true, request: requestSummary(doc) });
  } catch (err) {
    console.error("[Verification] create request failed:", err.message);
    res.status(500).json({ message: "Failed to submit verification request" });
  }
});

// GET /api/verification/requests/me — resident checks their own latest request.
router.get("/requests/me", async (req, res) => {
  try {
    const [doc, user] = await Promise.all([
      VerificationRequest.findOne({ userId: req.user.id }).sort({ createdAt: -1 }).lean(),
      User.findById(req.user.id).select("residencyStatus"),
    ]);

    res.json({
      success: true,
      residencyStatus: user?.residencyStatus ?? "unverified",
      request: doc ? requestSummary(doc) : null,
    });
  } catch (err) {
    console.error("[Verification] fetch my request failed:", err.message);
    res.status(500).json({ message: "Failed to load verification status" });
  }
});

// GET /api/verification/requests — system_admin review queue.
router.get("/requests", requireRole("system_admin"), async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) {
      if (!VERIFICATION_STATUSES.includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      filter.status = status;
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const [requests, total] = await Promise.all([
      VerificationRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      VerificationRequest.countDocuments(filter),
    ]);

    res.json({
      success: true,
      requests: requests.map(requestSummary),
      total,
      page,
      limit,
    });
  } catch (err) {
    console.error("[Verification] list requests failed:", err.message);
    res.status(500).json({ message: "Failed to load verification requests" });
  }
});

// PATCH /api/verification/requests/:id/status — system_admin approves/rejects.
router.patch("/requests/:id/status", requireRole("system_admin"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid request id" });
    }

    const { status, adminNotes } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Status must be 'approved' or 'rejected'" });
    }

    const doc = await VerificationRequest.findById(id);
    if (!doc) return res.status(404).json({ message: "Request not found" });

    const trimmedNotes = typeof adminNotes === "string" ? adminNotes.trim().slice(0, 1000) : "";
    const actorName = req.user.name || req.user.email || "staff";
    const now = new Date();

    doc.status = status;
    doc.adminNotes = trimmedNotes;
    doc.reviewedBy = actorName;
    doc.reviewedAt = now;
    doc.logs.push({
      action: "status_change",
      byId: req.user.id,
      byName: actorName,
      byRole: req.user.role,
      at: now,
      notes: trimmedNotes,
    });
    await doc.save();

    await User.findByIdAndUpdate(doc.userId, {
      residencyStatus: status === "approved" ? "verified" : "rejected",
    });

    sendPushToUser(doc.userId, {
      title: status === "approved" ? "Residency verified" : "Verification rejected",
      body:
        status === "approved"
          ? "You're now a verified resident — Reports and Chat are unlocked."
          : trimmedNotes || "Your residency verification request was rejected. You can submit a new one.",
      url: "/profile",
      tag: `verification-${doc._id}`,
    }).catch((err) => console.error("[Verification] push notify failed:", err.message));

    res.json({ success: true, request: requestSummary(doc) });
  } catch (err) {
    console.error("[Verification] status update failed:", err.message);
    res.status(500).json({ message: "Failed to update verification request" });
  }
});

export default router;
