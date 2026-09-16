export const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? `http://${window.location.hostname}:5000`);

export const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

export function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString("en-PH", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function splitDateTime(dateStr) {
  if (!dateStr) return { date: "", time: "" };
  const d = new Date(dateStr);
  return {
    date: d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }),
    time: d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" }),
  };
}

export function getStatusColor(status) {
  switch (status) {
    case "open":      return "text-blue-600";
    case "matched":   return "text-purple-600";
    case "pending":   return "text-orange-500";
    case "approved":  return "text-blue-500";
    case "fulfilled": return "text-green-500";
    case "rejected":  return "text-red-500";
    case "cancelled": return "text-red-400";
    case "offered":   return "text-orange-500";
    case "scheduled": return "text-blue-500";
    case "received":  return "text-green-500";
    default:          return "text-gray-500";
  }
}

export function getStatusDotColor(status) {
  switch (status) {
    case "open":      return "bg-blue-600";
    case "matched":   return "bg-purple-600";
    case "pending":   return "bg-orange-500";
    case "approved":  return "bg-blue-500";
    case "fulfilled": return "bg-green-500";
    case "rejected":  return "bg-red-500";
    case "cancelled": return "bg-red-400";
    case "offered":   return "bg-orange-500";
    case "scheduled": return "bg-blue-500";
    case "received":  return "bg-green-500";
    default:          return "bg-gray-500";
  }
}
