// Single source of truth for role → navigation/access mapping.
//
// Only routes/pages that exist today are listed here.
import {
  Bell,
  Siren,
  Map,
  MapPin,
  Users,
  BookOpen,
  Sparkles,
  LayoutDashboard,
  Monitor,
} from "lucide-react";
import { LuLogs } from "react-icons/lu";

export const ROLE_LABELS = {
  system_admin: "System Admin",
  cdrrmo: "CDRRMO",
  barangay_official: "Barangay Official",
  user: "Resident",
};

// Where each role lands after login / when hitting an unauthorized route.
export const ROLE_HOME = {
  system_admin: "/manage-users",
  cdrrmo: "/dashboard",
  barangay_official: "/dashboard",
};

export const ROLE_NAV_ITEMS = {
  // System Admin is web-platform/account-management only — zero disaster-ops
  // access.
  system_admin: [
    { icon: Users, label: "User Management", href: "/manage-users" },
    { icon: Monitor, label: "Chat Monitoring", href: "/chat-monitoring" },
    { icon: LuLogs, label: "Audit Logs", href: "/audit-logs" },
    { icon: Sparkles, label: "AI Model Performance", href: "/model-performance" },
  ],
  // CDRRMO — full city-wide disaster-ops access (all barangays).
  cdrrmo: [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
    { icon: Bell, label: "Alerts", href: "/alerts" },
    { icon: Siren, label: "Reports", href: "/reports" },
    { icon: Map, label: "Hazard Map", href: "/hazard-map" },
    { icon: MapPin, label: "Evacuation Centers", href: "/evacuation" },
    { icon: BookOpen, label: "Safety Tips", href: "/safety-tips" },
  ],
  // Barangay Official — scoped to their assigned barangay only (enforced server-side).
  barangay_official: [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
    { icon: Bell, label: "Alerts", href: "/alerts" },
    { icon: Siren, label: "Reports", href: "/reports" },
    { icon: Map, label: "Hazard Map", href: "/hazard-map" },
    { icon: MapPin, label: "Evacuation Centers", href: "/evacuation" },
    { icon: BookOpen, label: "Safety Tips", href: "/safety-tips" },
  ],
};

export function getUserRole() {
  const stored = localStorage.getItem("user");
  if (!stored) return null;
  try {
    return JSON.parse(stored).role ?? null;
  } catch {
    return null;
  }
}

export function getAssignedBarangay() {
  const stored = localStorage.getItem("user");
  if (!stored) return null;
  try {
    return JSON.parse(stored).assignedBarangay ?? null;
  } catch {
    return null;
  }
}

export function getHomePath(role) {
  return ROLE_HOME[role] || "/login";
}

export function getAllowedRoutes(role) {
  return (ROLE_NAV_ITEMS[role] || []).map((item) => item.href);
}
