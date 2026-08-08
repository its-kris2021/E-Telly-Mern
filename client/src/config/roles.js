// Mirrors server/config/roles.js — roles with full/partial disaster-ops
// access. Deliberately excludes "system_admin" (web-platform/account
// management only, zero disaster-ops access).
export const OPS_ROLES = ["cdrrmo", "barangay_official"];

export const isOpsRole = (role) => OPS_ROLES.includes(role);
