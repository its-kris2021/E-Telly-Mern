import jwt from "jsonwebtoken";

// Mirrors the JWT payload shape signed at login (server/routes/auth.js):
// { id, name, role, assignedBarangay }.
export function makeToken({ id, name = "Test User", role, assignedBarangay = null }) {
  return jwt.sign({ id, name, role, assignedBarangay }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
}
