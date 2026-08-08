// Roles with full/partial disaster-ops access (dashboard, alerts, reports,
// hazard map, evacuation, community sharing). Deliberately excludes
// "system_admin" — System Admin is web-platform/account-management only.
export const OPS_ROLES = ["cdrrmo", "barangay_official"];

export const isOpsRole = (role) => OPS_ROLES.includes(role);
