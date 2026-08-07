// Single source of truth for role → navigation/access mapping.
//
// Only routes/pages that exist today are listed here.
import {
  LayoutDashboard,
  Bell,
  Volume2,
  Map,
  MapPin,
  Users,
  InfoIcon,
  HandHelpingIcon,
} from "lucide-react";

export const ROLE_LABELS = {
  admin: "Admin",
  barangay_official: "Barangay Official",
  user: "User",
};

// Where each role lands after login / when hitting an unauthorized route.
export const ROLE_HOME = {
  admin: "/dashboard",
  barangay_official: "/dashboard",
};

export const ROLE_NAV_ITEMS = {
  admin: [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
    { icon: Bell, label: "Alerts", href: "/alerts" },
    { icon: Volume2, label: "Reports", href: "/reports" },
    { icon: Map, label: "Hazard Map", href: "/hazard-map" },
    { icon: MapPin, label: "Evacuation Centers", href: "/evacuation" },
    { icon: HandHelpingIcon, label: "Community Sharing", href: "/community-sharing" },
    { icon: InfoIcon, label: "Safety Tips", href: "/safety-tips" },
    { icon: Users, label: "Manage Users", href: "/manage-users" },
  ],
  barangay_official: [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
    { icon: Bell, label: "Alerts", href: "/alerts" },
    { icon: Volume2, label: "Reports", href: "/reports" },
    { icon: Map, label: "Hazard Map", href: "/hazard-map" },
    { icon: MapPin, label: "Evacuation Centers", href: "/evacuation" },
    { icon: HandHelpingIcon, label: "Community Sharing", href: "/community-sharing" },
    { icon: InfoIcon, label: "Safety Tips", href: "/safety-tips" },
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

export function getHomePath(role) {
  return ROLE_HOME[role] || "/login";
}

export function getAllowedRoutes(role) {
  return (ROLE_NAV_ITEMS[role] || []).map((item) => item.href);
}
