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

// Generic role gate. Usage: requireRole("system_admin") or requireRole("cdrrmo", "barangay_official").
export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role))
    return res.status(403).json({ message: "Insufficient permissions" });
  next();
};

// Blocks a barangay_official whose account has no assignedBarangay from
// touching any barangay-scoped resource. Other roles pass through untouched.
export const requireAssignedBarangayIfOfficial = (req, res, next) => {
  if (req.user.role === "barangay_official" && !req.user.assignedBarangay)
    return res.status(403).json({ message: "No barangay assigned to this account" });
  next();
};

// Mongo filter scoping a barangay-keyed collection/model query to the
// caller's turf: {} (unscoped) for cdrrmo/system_admin, {[keyField]: their
// barangay} for barangay_official. keyField defaults to "barangayKey" —
// pass "reporterBarangayKey" for emergency_reports (the reporter's
// *registered profile* barangay, not the GPS-derived incident location —
// see routes/reports.js) or "barangay" for EvacuationCenter/community models.
export const scopeToAssignedBarangay = (req, keyField = "barangayKey") =>
  req.user.role === "barangay_official"
    ? { [keyField]: req.user.assignedBarangay }
    : {};

// Write-path guard: 403s and returns true if a barangay_official is acting
// on a resource outside their assignedBarangay. No-op (returns false) for
// every other role. Caller is responsible for sending the response and
// returning immediately when this returns true.
export const rejectIfOutsideAssignedBarangay = (req, res, resourceBarangayKey) => {
  if (req.user.role !== "barangay_official") return false;
  if (resourceBarangayKey !== req.user.assignedBarangay) {
    res.status(403).json({ success: false, message: "Outside your assigned barangay" });
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
