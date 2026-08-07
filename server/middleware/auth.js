import jwt from "jsonwebtoken";

export const protect = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token)
    return res.status(401).json({ message: "No token, unauthorized" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: "Invalid token" });
  }
};

export const requireAdmin = (req, res, next) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ message: "Admin access required" });
  next();
};

export const requireAdminOrBarangay = (req, res, next) => {
  if (!["admin", "barangay_official"].includes(req.user.role))
    return res.status(403).json({ message: "Insufficient permissions" });
  if (req.user.role === "barangay_official" && !req.user.assignedBarangay)
    return res.status(403).json({ message: "No barangay assigned to this account" });
  next();
};

// Mongo filter that scopes emergency_reports queries to the caller's barangay.
// admin (CDRRMO) sees everything; barangay_official sees only their own turf.
// Must run after requireAdminOrBarangay, which guarantees assignedBarangay is
// set for barangay_official callers.
export const reportBarangayFilter = (req) =>
  req.user.role === "barangay_official"
    ? { barangayKey: req.user.assignedBarangay }
    : {};

// Throws-as-response guard for single-report write endpoints (update-status,
// resolve): confirms a barangay_official isn't acting on a report outside
// their assigned barangay. Returns true if the request was rejected (caller
// should return immediately); false if it may proceed.
export const rejectIfOutsideAssignedBarangay = (req, res, reportBarangayKey) => {
  if (req.user.role !== "barangay_official") return false;
  if (reportBarangayKey !== req.user.assignedBarangay) {
    res.status(403).json({ success: false, error: "Report is outside your assigned barangay" });
    return true;
  }
  return false;
};

// Soft auth — sets req.user if a valid Bearer token is present, otherwise req.user = null.
// Unlike protect(), always calls next() — invalid/expired tokens are treated as anonymous.
export const optionalProtect = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      req.user = null;
    }
  } else {
    req.user = null;
  }
  next();
};
