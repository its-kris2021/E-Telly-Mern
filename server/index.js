import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import hazardRoutes from "./routes/hazard.js";
import alertRoutes from "./routes/alerts.js";
import reportRoutes from "./routes/reports.js";
import evacuationRoutes from "./routes/evacuation.js";
import communityRoutes from "./routes/community.js";
import pushRoutes, { sendNotificationToAll, sendAdminNotification } from "./routes/push.js";
import syncRoutes from "./routes/sync.js";
import uploadImagesRoutes from "./routes/uploadImages.js";
import adminMetricsRoutes from "./routes/adminMetrics.js";
import { startAlertEngine } from "./scripts/alertEngine.js";
import { startSyncScheduler } from "./scripts/syncToCloud.js";
import Alert from "./models/Alert.js";
import {
  protect,
  requireAdminOrBarangay,
  reportBarangayFilter,
  rejectIfOutsideAssignedBarangay,
} from "./middleware/auth.js";
import rateLimit from "express-rate-limit";

dotenv.config();

const app = express();
const server = createServer(app);
const isLocalMode = process.env.LOCAL_MODE === "true";

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:4173",
  "http://localhost:3000",
  /\.herokuapp\.com$/,
  ...(isLocalMode ? [/^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/] : []),
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = allowedOrigins.some((o) =>
      o instanceof RegExp ? o.test(origin) : o === origin
    );
    callback(allowed ? null : new Error("Not allowed by CORS"), allowed);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  credentials: true,
};

const io = new Server(server, {
  pingInterval: 20000,
  pingTimeout: 10000,
  cors: corsOptions,
});

app.use(cors(corsOptions));
app.use(express.json());

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, error: "Too many login attempts, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const publicPostLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Make io accessible inside route handlers via req.app.get("io")
app.set("io", io);

// Routes
app.use("/api/auth/login", loginLimiter);
app.use("/api/reports/create", publicPostLimiter);
app.use("/api/reports/upload-images", publicPostLimiter);
app.post("/api/community/requests", publicPostLimiter);
app.post("/api/community/donations", publicPostLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/hazard", hazardRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/evacuation", evacuationRoutes);
app.use("/api/community", communityRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/sync", syncRoutes);
app.use("/api/reports", uploadImagesRoutes);
app.use("/api/admin", adminMetricsRoutes);
app.use("/uploads", express.static(join(dirname(fileURLToPath(import.meta.url)), "uploads")));

// Socket.IO
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("join", ({ userId }) => {
    if (userId) socket.join(`user-${userId}`);
  });

  socket.on("join_admin", () => {
    socket.join("admin-room");
  });

  socket.on("join_request", ({ requestId }) => {
    if (requestId) socket.join(`request-${requestId}`);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// Health check — Flutter app pings this to confirm local server is reachable
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    mode: isLocalMode ? "LOCAL" : "CLOUD",
    message: "Server is running",
  });
});

// GET all reports — admin only
app.get("/api/reports", protect, requireAdminOrBarangay, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1)
      return res.status(500).json({ success: false, error: "Database not connected" });
    const reports = await mongoose.connection.db
      .collection("emergency_reports")
      .find(reportBarangayFilter(req))
      .sort({ timestamp: -1 })
      .toArray();
    res.json({ success: true, reports });
  } catch (error) {
    console.error("Error fetching reports:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Receives push from mobile app and broadcasts via Socket.IO + web push
app.post("/api/notify-emergency", protect, requireAdminOrBarangay, (req, res) => {
  const report = req.body;
  io.emit("new_emergency_report", {
    id: report.reportId,
    emergencyType: report.emergencyType,
    severity: report.severity,
    location: report.location,
    barangay: report.barangay,
    city: report.city || "Antipolo City, Rizal",
    timestamp: new Date().toISOString(),
    userName: report.userName,
    phoneNumber: report.phoneNumber,
    description: report.description || "",
    status: "pending",
  });

  const emergencyType = report.emergencyType || "Emergency";
  const severity = report.severity ? ` (${report.severity})` : "";
  const locationLabel = report.barangay || report.location || "Unknown location";
  sendAdminNotification({
    title: `New Report: ${emergencyType}${severity}`,
    body: `A new pending report was submitted from ${locationLabel}. Tap to review.`,
    url: "/reports",
    tag: `report-${report.reportId}`,
    urgent: true,
  }).catch((err) => console.error("[Push] Report notification failed:", err));

  res.json({ success: true });
});

// Update report status
app.post("/api/reports/update-status", protect, requireAdminOrBarangay, async (req, res) => {
  try {
    const { reportId, status, adminNotes, adminEmail } = req.body;

    if (!mongoose.Types.ObjectId.isValid(reportId))
      return res.status(400).json({ success: false, error: "Invalid report ID" });

    const VALID_STATUSES = ["pending", "approved", "rejected", "resolved"];
    if (!VALID_STATUSES.includes(status))
      return res.status(400).json({ success: false, error: "Invalid status value" });

    const report = await mongoose.connection.db
      .collection("emergency_reports")
      .findOne({ _id: new mongoose.Types.ObjectId(reportId) });
    if (!report)
      return res.status(404).json({ success: false, error: "Report not found" });
    if (rejectIfOutsideAssignedBarangay(req, res, report.barangayKey)) return;

    const result = await mongoose.connection.db
      .collection("emergency_reports")
      .updateOne(
        { _id: new mongoose.Types.ObjectId(reportId) },
        {
          $set: {
            status,
            adminNotes: adminNotes || "",
            reviewedBy: adminEmail || "admin",
            reviewedAt: new Date().toISOString(),
            ...(isLocalMode && { syncedToCloud: false }),
          },
          $push: {
            logs: {
              action: status,
              by: adminEmail || "admin",
              at: new Date().toISOString(),
              notes: adminNotes || "",
            },
          },
        },
      );
    if (result.modifiedCount > 0) {
      io.emit("report_updated", { reportId, status, adminNotes });
      io.emit("report_status_updated", {
        reportId,
        status,
        ...(status === "approved" && report ? { report } : {}),
      });

      if (status === "approved" && report) {
        const severityMap = { high: "critical", medium: "warning", low: "watch" };
        const alertSeverity = severityMap[report.severity?.toLowerCase()] || "warning";
        const typeName = report.emergencyType?.charAt(0).toUpperCase() + report.emergencyType?.slice(1) || "Emergency";
        const VALID_TYPES = ["fire","flood","rainfall","earthquake","lahar","typhoon","storm","landslide","rescue","other"];
        const alertType = VALID_TYPES.includes(report.emergencyType) ? report.emergencyType : "other";
        const savedAlert = await Alert.create({
          type: alertType,
          title: `Community Report: ${typeName}`,
          description: report.description || "Emergency report approved by CDRRMO",
          severity: alertSeverity,
          location: report.location?.exactAddress || (typeof report.location === "string" ? report.location : "") || "Unknown location",
          source: "residents",
          linkedReportId: new mongoose.Types.ObjectId(reportId),
          lat: report.latitude ?? null,
          lng: report.longitude ?? null,
          // No expiresAt — community report alerts must be resolved/dismissed manually
        });
        io.emit("new_alert", savedAlert.toObject());

        const isUrgent = alertSeverity === "evacuate" || alertSeverity === "critical";
        sendNotificationToAll({
          title: `Alert: Community Report — ${typeName}`,
          body: `${savedAlert.location}: ${savedAlert.description.slice(0, 100)}`,
          url: "/alerts",
          tag: `community-report-${reportId}`,
          urgent: isUrgent,
        }).catch((err) => console.error("[Push] Approved report alert push failed:", err));
      }

      res.json({ success: true });
    } else {
      res.json({ success: false });
    }
  } catch (error) {
    console.error("Error updating report status:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Resolve report
app.post("/api/reports/resolve", protect, requireAdminOrBarangay, async (req, res) => {
  try {
    const { reportId, resolvedBy, resolutionNotes } = req.body;

    if (!mongoose.Types.ObjectId.isValid(reportId))
      return res.status(400).json({ success: false, error: "Invalid report ID" });

    const existingReport = await mongoose.connection.db
      .collection("emergency_reports")
      .findOne({ _id: new mongoose.Types.ObjectId(reportId) }, { projection: { barangayKey: 1 } });
    if (!existingReport)
      return res.status(404).json({ success: false, error: "Report not found" });
    if (rejectIfOutsideAssignedBarangay(req, res, existingReport.barangayKey)) return;

    const result = await mongoose.connection.db
      .collection("emergency_reports")
      .updateOne(
        { _id: new mongoose.Types.ObjectId(reportId) },
        {
          $set: {
            status: "resolved",
            resolvedBy: resolvedBy || "admin",
            resolvedAt: new Date().toISOString(),
            resolutionNotes: resolutionNotes || "",
            ...(isLocalMode && { syncedToCloud: false }),
          },
          $push: {
            logs: {
              action: "resolved",
              by: resolvedBy || "admin",
              at: new Date().toISOString(),
              notes: resolutionNotes || "",
            },
          },
        },
      );
    if (result.modifiedCount > 0) {
      io.emit("report_updated", { reportId, status: "resolved" });
      io.emit("report_status_updated", { reportId, status: "resolved" });

      // Dismiss any alert that was auto-created when this report was approved
      try {
        const linkedAlert = await Alert.findOneAndUpdate(
          { linkedReportId: new mongoose.Types.ObjectId(reportId), isActive: true },
          { $set: { isActive: false } },
          { new: true },
        );
        if (linkedAlert) {
          io.emit("alert_updated", { id: String(linkedAlert._id), isActive: false });
        }
      } catch (alertErr) {
        console.error("[Resolve] Failed to dismiss linked alert:", alertErr.message);
      }

      res.json({ success: true });
    } else {
      res.json({ success: false });
    }
  } catch (error) {
    console.error("Error resolving report:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

if (process.env.NODE_ENV === "production") {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  app.use(express.static(join(__dirname, "../client/dist")));
  app.get(/(.*)/, (req, res) => {
    res.sendFile(join(__dirname, "../client/dist", "index.html"));
  });
}

const mongoUri = isLocalMode
  ? process.env.LOCAL_MONGO_URI || "mongodb://localhost:27017/etelly_local"
  : process.env.MONGO_URI;

const mongoOptions = isLocalMode ? {} : { dbName: "etelly" };

mongoose
  .connect(mongoUri, mongoOptions)
  .then(() => {
    const dbLabel = isLocalMode ? "LOCAL (etelly_local)" : "Atlas (etelly)";
    console.log(`Connected to MongoDB — ${dbLabel}`);

    if (!isLocalMode) {
      startAlertEngine();
    } else {
      console.log("[Local Mode] Alert engine skipped (no internet).");
      console.log("[Local Mode] Sync scheduler started — watches for internet every 30s.");
      startSyncScheduler();
    }

    // Watch for new reports from any source (including Flutter direct saves)
    try {
      const reportsCol = mongoose.connection.db.collection("emergency_reports");
      const changeStream = reportsCol.watch([{ $match: { operationType: "insert" } }]);

      changeStream.on("change", (change) => {
        const doc = change.fullDocument;
        if (!doc) return;

        io.emit("new_emergency_report", {
          id: doc._id,
          emergencyType: doc.emergencyType,
          severity: doc.severity,
          location: doc.location,
          timestamp: doc.timestamp || new Date(),
          userName: doc.userName,
          description: doc.description || "",
          status: doc.status || "pending",
        });

        const emergencyType = doc.emergencyType || "Emergency";
        const severity = doc.severity ? ` (${doc.severity})` : "";
        const locationLabel =
          doc.location?.barangay ||
          doc.location?.address ||
          (typeof doc.location === "string" ? doc.location : "") ||
          "Unknown location";

        sendAdminNotification({
          title: `New Report: ${emergencyType}${severity}`,
          body: `A new pending report was submitted from ${locationLabel}. Tap to review.`,
          url: "/reports",
          tag: `report-${doc._id}`,
          urgent: true,
        }).catch((err) => console.error("[Push] Report notification failed:", err));
      });

      changeStream.on("error", (err) =>
        console.error("[ChangeStream] emergency_reports error:", err.message)
      );

      console.log("[ChangeStream] Watching emergency_reports for new inserts");
    } catch (err) {
      console.error("[ChangeStream] Failed to start:", err.message);
    }

    const PORT = process.env.PORT || 5000;
    server.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT} (0.0.0.0)`));
  })
  .catch((err) => console.error("MongoDB connection failed:", err));
