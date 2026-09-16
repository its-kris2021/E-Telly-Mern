import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import compression from "compression";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join, sep } from "path";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import hazardRoutes from "./routes/hazard.js";
import alertRoutes from "./routes/alerts.js";
import reportRoutes from "./routes/reports.js";
import evacuationRoutes from "./routes/evacuation.js";
import pushRoutes, { sendAdminNotification, sendPushToUser } from "./routes/push.js";
import syncRoutes from "./routes/sync.js";
import uploadImagesRoutes from "./routes/uploadImages.js";
import adminMetricsRoutes from "./routes/adminMetrics.js";
import familyRoutes from "./routes/family.js";
import messageReportRoutes from "./routes/messageReports.js";
import chatModerationRoutes from "./routes/chatModeration.js";
import chatRestrictionRoutes from "./routes/chatRestriction.js";
import auditLogRoutes from "./routes/auditLogs.js";
import { startAlertEngine } from "./scripts/alertEngine.js";
import { startSyncScheduler } from "./scripts/syncToCloud.js";
import { startChatModerationScheduler } from "./scripts/chatModerationScheduler.js";
import Alert from "./models/Alert.js";
import { signAlert } from "./services/alertSigning.js";
import { getRestrictionStatus } from "./services/chatRestrictionService.js";
import { protect, requireRole, requireAssignedBarangayIfOfficial, scopeToAssignedBarangay, rejectIfOutsideAssignedBarangay } from "./middleware/auth.js";
import rateLimit from "express-rate-limit";

dotenv.config();

const app = express();
const server = createServer(app);
const isLocalMode = process.env.LOCAL_MODE === "true";

// Gzip/brotli-eligible compression for every response (JSON API replies and
// the built client bundle alike) — Heroku's router doesn't compress on our
// behalf, so without this the ~250KB JS bundle ships byte-for-byte uncompressed.
app.use(compression());

// Security headers for browser responses. HSTS is production-only because it
// would make local HTTP development inconvenient after a browser caches it.
app.use((req, res, next) => {
  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains"
    );
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(self), camera=(), microphone=(), payment=(), usb=()"
  );
  // Origins below are every third-party host the client actually loads from
  // (map tiles/hazard data in src/components/map/**, the LocationPicker's
  // CDN-loaded Leaflet, and OSM Nominatim geocoding) — add a host here
  // before wiring up a new one client-side, or the browser will block it.
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://unpkg.com",
      "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://server.arcgisonline.com https://*.tile.opentopomap.org https://lipad-fmc.dream.upd.edu.ph https://geoserver.geoportal.gov.ph https://res.cloudinary.com",
      "connect-src 'self' https://nominatim.openstreetmap.org https://earthquake.usgs.gov https://lipad-fmc.dream.upd.edu.ph https://geoserver.geoportal.gov.ph https://geoportal.gov.ph https://www.gdacs.org https://bagong.pagasa.dost.gov.ph https://www.pagasa.dost.gov.ph",
      "worker-src 'self'",
      "manifest-src 'self'",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ")
  );

  next();
});

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:4173",
  "http://localhost:3000",
  /\.herokuapp\.com$/,
  /(^|\.)e-tellyph\.com$/,
  ...(isLocalMode ? [/^192\.168\.\d+\.\d+$/] : []),
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    // Regex entries match against the parsed hostname, not the raw origin
    // string — matching the scheme-prefixed string directly (e.g.
    // "https://e-tellyph.com") meant the apex domain never matched
    // /(^|\.)e-tellyph\.com$/ (nothing "." or "^"-anchored precedes it,
    // "//" does), while "https://www.e-tellyph.com" only matched by
    // accident because "www." happens to end in a dot. Since Vite emits
    // <script type="module" crossorigin>, every asset request sends an
    // Origin header even when same-origin, so this was rejecting the
    // apex domain's JS/CSS with a bare 500 for every visitor.
    let hostname;
    try {
      hostname = new URL(origin).hostname;
    } catch {
      return callback(new Error("Not allowed by CORS"), false);
    }
    const allowed = allowedOrigins.some((o) =>
      o instanceof RegExp ? o.test(hostname) : o === origin
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
  // Only enforce in production — during local dev (nodemon, no NODE_ENV set)
  // this was tripping constantly from normal testing/retries and required
  // a server restart to clear, with no brute-force benefit on a dev machine.
  skip: () => process.env.NODE_ENV !== "production",
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

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/hazard", hazardRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/evacuation", evacuationRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/sync", syncRoutes);
app.use("/api/reports", uploadImagesRoutes);
app.use("/api/admin", adminMetricsRoutes);
app.use("/api/family", familyRoutes);
app.use("/api/message-reports", messageReportRoutes);
app.use("/api/chat-monitoring", chatModerationRoutes);
app.use("/api/chat-restriction", chatRestrictionRoutes);
app.use("/api/audit-logs", auditLogRoutes);
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

  // Profile edits are written straight from the mobile app to MongoDB (no
  // REST route involved), so there's no request handler here to emit this
  // from — the saving device signals it itself, and we relay it only to
  // that user's OTHER sessions (socket.to excludes the sender, which
  // already has the data it just saved).
  socket.on("profile_updated", ({ userId }) => {
    if (userId) socket.to(`user-${userId}`).emit("profile_updated", { userId });
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

// GET all reports — System Admin/CDRRMO (city-wide) / Barangay Official (own barangay only)
app.get("/api/reports", protect, requireRole("system_admin", "cdrrmo", "barangay_official"), requireAssignedBarangayIfOfficial, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1)
      return res.status(500).json({ success: false, error: "Database not connected" });
    const reports = await mongoose.connection.db
      .collection("emergency_reports")
      .find({
        ...scopeToAssignedBarangay(req, "reporterBarangayKey"),
        // Historical bulk-import rows (scripts/importHistoricalReports.js)
        // are training labels only, not real reports for admins to review.
        importSource: { $ne: "historical_excel_import" },
      })
      .sort({ timestamp: -1 })
      .toArray();
    res.json({ success: true, reports });
  } catch (error) {
    console.error("Error fetching reports:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Receives push from mobile app and broadcasts via Socket.IO + web push
app.post("/api/notify-emergency", protect, requireRole("cdrrmo", "barangay_official"), (req, res) => {
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
app.post("/api/reports/update-status", protect, requireRole("system_admin", "cdrrmo", "barangay_official"), requireAssignedBarangayIfOfficial, async (req, res) => {
  try {
    const { reportId, status, adminNotes } = req.body;

    if (!mongoose.Types.ObjectId.isValid(reportId))
      return res.status(400).json({ success: false, error: "Invalid report ID" });

    const VALID_STATUSES = ["pending", "approved", "rejected", "resolved"];
    if (!VALID_STATUSES.includes(status))
      return res.status(400).json({ success: false, error: "Invalid status value" });

    const existingReport = await mongoose.connection.db.collection("emergency_reports").findOne({ _id: new mongoose.Types.ObjectId(reportId) });
    if (!existingReport)
      return res.status(404).json({ success: false, error: "Report not found" });
    if (rejectIfOutsideAssignedBarangay(req, res, existingReport.reporterBarangayKey)) return;

    const report = status === "approved" ? existingReport : null;
    // Actor identity comes from the authenticated session, never client input
    // (a request-body "adminEmail" field would let anyone spoof who's
    // recorded as having reviewed this report).
    const actorName = req.user.name || req.user.email || "admin";

    const result = await mongoose.connection.db
      .collection("emergency_reports")
      .updateOne(
        { _id: new mongoose.Types.ObjectId(reportId) },
        {
          $set: {
            status,
            adminNotes: adminNotes || "",
            reviewedBy: actorName,
            reviewedAt: new Date().toISOString(),
            ...(isLocalMode && { syncedToCloud: false }),
          },
          $push: {
            logs: {
              action: status,
              by: actorName,
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

      // Reports don't store the reporter's User _id (only their email), so
      // resolve it here — same pattern routes/reports.js uses when creating
      // the report — to target the push at the one resident who filed it.
      if (status === "approved" || status === "rejected") {
        const reporterEmail = (existingReport.reporterEmail || existingReport.userData?.email || "").trim().toLowerCase();
        if (reporterEmail) {
          mongoose.connection.db.collection("users")
            .findOne({ email: reporterEmail }, { projection: { _id: 1 } })
            .then((reporterUser) => {
              if (!reporterUser) return;
              return sendPushToUser(reporterUser._id, {
                title: status === "approved" ? "Report Approved" : "Report Rejected",
                body: status === "approved"
                  ? "Your emergency report has been reviewed and approved."
                  : adminNotes
                    ? `Your emergency report was not approved. Reason: ${adminNotes}`
                    : "Your emergency report was reviewed and was not approved.",
                url: "/reports",
                tag: `report-status-${reportId}`,
              });
            })
            .catch((err) => console.error("[Push] Reporter status notification failed:", err.message));
        }
      }

      if (status === "approved" && report) {
        const severityMap = { high: "critical", medium: "warning", low: "watch" };
        const alertSeverity = severityMap[report.severity?.toLowerCase()] || "warning";
        const typeName = report.emergencyType?.charAt(0).toUpperCase() + report.emergencyType?.slice(1) || "Emergency";
        const VALID_TYPES = ["fire","flood","rainfall","earthquake","lahar","typhoon","storm","landslide","rescue","other"];
        const alertType = VALID_TYPES.includes(report.emergencyType) ? report.emergencyType : "other";
        // _id/createdAt/isActive are set explicitly (rather than left to
        // schema defaults) because signAlert() needs their final values
        // before the document is inserted — see the same pattern in
        // routes/alerts.js's POST handler.
        const alertFields = {
          _id: new mongoose.Types.ObjectId(),
          type: alertType,
          title: `Community Report: ${typeName}`,
          description: report.description || "Emergency report approved by CDRRMO",
          severity: alertSeverity,
          location: report.location?.exactAddress || (typeof report.location === "string" ? report.location : "") || "Unknown location",
          barangays: [],
          source: "residents",
          linkedReportId: new mongoose.Types.ObjectId(reportId),
          lat: report.latitude ?? null,
          lng: report.longitude ?? null,
          isActive: true,
          createdAt: new Date(),
          // No expiresAt — community report alerts must be resolved/dismissed manually
        };
        const signed = signAlert(alertFields);

        const savedAlert = await Alert.create({
          ...alertFields,
          ...(signed ? { signature: signed.signature, keyId: signed.keyId } : {}),
        });
        io.emit("new_alert", savedAlert.toObject());
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
app.post("/api/reports/resolve", protect, requireRole("system_admin", "cdrrmo", "barangay_official"), requireAssignedBarangayIfOfficial, async (req, res) => {
  try {
    const { reportId, resolutionNotes } = req.body;

    if (!mongoose.Types.ObjectId.isValid(reportId))
      return res.status(400).json({ success: false, error: "Invalid report ID" });

    const existingReport = await mongoose.connection.db.collection("emergency_reports").findOne({ _id: new mongoose.Types.ObjectId(reportId) });
    if (!existingReport)
      return res.status(404).json({ success: false, error: "Report not found" });
    if (rejectIfOutsideAssignedBarangay(req, res, existingReport.reporterBarangayKey)) return;

    // Actor identity comes from the authenticated session, never client input
    // (a request-body "resolvedBy" field would let anyone spoof who's
    // recorded as having resolved this report).
    const actorName = req.user.name || req.user.email || "admin";

    const result = await mongoose.connection.db
      .collection("emergency_reports")
      .updateOne(
        { _id: new mongoose.Types.ObjectId(reportId) },
        {
          $set: {
            status: "resolved",
            resolvedBy: actorName,
            resolvedAt: new Date().toISOString(),
            resolutionNotes: resolutionNotes || "",
            ...(isLocalMode && { syncedToCloud: false }),
          },
          $push: {
            logs: {
              action: "resolved",
              by: actorName,
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

      // Same reporterEmail -> User _id lookup used in the update-status route.
      const reporterEmail = (existingReport.reporterEmail || existingReport.userData?.email || "").trim().toLowerCase();
      if (reporterEmail) {
        mongoose.connection.db.collection("users")
          .findOne({ email: reporterEmail }, { projection: { _id: 1 } })
          .then((reporterUser) => {
            if (!reporterUser) return;
            return sendPushToUser(reporterUser._id, {
              title: "Report Resolved",
              body: resolutionNotes
                ? `Your emergency report has been marked resolved. Notes: ${resolutionNotes}`
                : "Your emergency report has been marked resolved.",
              url: "/reports",
              tag: `report-status-${reportId}`,
            });
          })
          .catch((err) => console.error("[Push] Reporter resolve notification failed:", err.message));
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
  app.use(
    express.static(join(__dirname, "../client/dist"), {
      setHeaders: (res, filePath) => {
        // Vite content-hashes everything under /assets, so those files never
        // change under a given URL — safe to cache for a year. index.html,
        // sw.js, registerSW.js, and manifest.webmanifest are entry points
        // that *reference* those hashes and must be revalidated on every
        // load, or clients would keep pointing at a stale bundle after
        // deploy. /icons isn't hashed either, but it changes rarely enough
        // (app icon) that a short reusable cache still beats max-age=0.
        if (filePath.includes(`${sep}assets${sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (filePath.includes(`${sep}icons${sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=604800");
        } else {
          res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
        }
      },
    }),
  );
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

    // Pure local-DB operation — runs in both local and cloud mode, unlike
    // the hazard-alert crons above which need upstream internet access.
    startChatModerationScheduler();

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

    // Server-side chat-restriction enforcement. Chat messages are written
    // directly into MongoDB by the Flutter mobile app (see routes/
    // messageReports.js), not through any endpoint in this server, so a
    // restricted resident can't be blocked "at the door" here. Instead this
    // watches every insert and immediately deletes any message whose sender
    // is currently restricted, notifying them over their `user-${id}` socket
    // room — enforcement that holds even if the mobile client never checks
    // GET /api/chat-restriction/status itself, and that survives
    // refresh/logout-login since it's re-evaluated from the DB on every
    // single insert rather than trusted from any client-held state.
    try {
      const messagesCol = mongoose.connection.db.collection("messages");
      const messagesChangeStream = messagesCol.watch([{ $match: { operationType: "insert" } }]);

      messagesChangeStream.on("change", async (change) => {
        const doc = change.fullDocument;
        if (!doc?.senderId) return;
        try {
          const status = await getRestrictionStatus(doc.senderId);
          if (status.restricted) {
            await messagesCol.deleteOne({ _id: doc._id });
            io.to(`user-${doc.senderId}`).emit("chat_restricted", {
              message: status.message,
              restrictionType: status.restrictionType,
              restrictionEndAt: status.restrictionEndAt,
              permanent: status.permanent,
            });
            return;
          }

          if (!doc.receiverId || !doc.text) return;

          // Push notification for the recipient — mobile chat is written
          // directly into MongoDB by the Flutter client (no REST endpoint),
          // so this change stream is the only place that can trigger it,
          // same reasoning as the restriction guard above.
          const senderObjectId = mongoose.Types.ObjectId.isValid(doc.senderId)
            ? new mongoose.Types.ObjectId(doc.senderId)
            : null;
          const sender = senderObjectId
            ? await mongoose.connection.db
                .collection("users")
                .findOne(
                  { _id: senderObjectId },
                  { projection: { name: 1, username: 1, email: 1 } },
                )
            : null;
          const senderName =
            sender?.name || sender?.username || sender?.email || "New message";

          sendPushToUser(doc.receiverId, {
            title: senderName,
            body: doc.text.slice(0, 100),
            url: "/chats",
            tag: `chat-${doc._id}`,
            // High priority (Android "high" / APNs priority 10) — chat push
            // is the whole point of this watcher (delivery while the app is
            // backgrounded or fully closed). Normal priority can be deferred
            // by Android Doze/App Standby or delayed by APNs "consider
            // power" scheduling when there's no running app to wake, which
            // would defeat that.
            urgent: true,
            data: {
              senderId: String(doc.senderId),
              senderName: String(senderName),
              senderUsername: String(sender?.username || sender?.email || ""),
            },
          }).catch((err) =>
            console.error("[Push] Chat message push failed:", err.message),
          );
        } catch (err) {
          console.error("[ChangeStream] messages restriction guard failed:", err.message);
        }
      });

      messagesChangeStream.on("error", (err) =>
        console.error("[ChangeStream] messages error:", err.message)
      );

      console.log("[ChangeStream] Watching messages for restricted senders");
    } catch (err) {
      console.error("[ChangeStream] Failed to start messages watcher:", err.message);
    }

    const PORT = process.env.PORT || 5000;
    server.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT} (0.0.0.0)`));
  })
  .catch((err) => console.error("MongoDB connection failed:", err));
