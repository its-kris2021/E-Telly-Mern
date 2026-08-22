import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  Map,
  MapPin,
  Volume2,
  InfoIcon,
  ShieldCheck,
  Clock,
  ArrowRight,
  TrendingUp,
} from "lucide-react";
import DashboardCard from "../components/admin/DashboardCard";
import { useAlerts } from "../hooks/useAlerts";
import { timeAgo } from "../utils/timeHelpers";
import { connectSocket } from "../utils/socket";

const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? "http://localhost:5000");

const modules = [
  {
    title: "Alerts",
    description: "Manage disaster alerts and notifications",
    icon: Bell,
    href: "/alerts",
    color: "bg-red-600",
  },
  {
    title: "Reports",
    description: "Review emergency reports from the community",
    icon: Volume2,
    href: "/reports",
    color: "bg-blue-800",
  },
  {
    title: "Hazard Mapping",
    description: "View live hazard layers on the map",
    icon: Map,
    href: "/hazard-map",
    color: "bg-orange-500",
  },
  {
    title: "Evacuation Centers",
    description: "Manage evacuation center locations",
    icon: MapPin,
    href: "/evacuation",
    color: "bg-green-500",
  },
  {
    title: "Safety Tips",
    description: "Manage safety tips and guidelines",
    icon: InfoIcon,
    href: "/safety-tips",
    color: "bg-indigo-700",
  },
];

const ALERT_LEFT_BORDER = {
  evacuate: "border-l-red-500",
  critical: "border-l-red-700",
  warning: "border-l-amber-500",
  watch: "border-l-blue-400",
};

const ALERT_BADGE = {
  evacuate: "bg-red-100 text-red-700",
  critical: "bg-red-50 text-red-800 border border-red-200",
  warning: "bg-amber-50 text-amber-800 border border-amber-200",
  watch: "bg-blue-50 text-blue-800 border border-blue-200",
};

const ALERT_LABEL = {
  evacuate: "EVACUATE",
  critical: "Critical",
  warning: "Warning",
  watch: "Watch",
};

function SkeletonRow() {
  return (
    <div className="px-5 py-4 flex items-center gap-3 animate-pulse border-l-4 border-l-gray-100">
      <div className="h-4 w-14 bg-gray-100 rounded-full" />
      <div className="flex-1 h-4 bg-gray-100 rounded" />
      <div className="h-3 w-10 bg-gray-100 rounded" />
    </div>
  );
}

function AllClearState({ label }) {
  return (
    <div className="px-6 py-10 text-center">
      <ShieldCheck size={26} className="text-green-400 mx-auto mb-2" />
      <p className="text-sm text-gray-500">{label}</p>
    </div>
  );
}

export default function DashboardPage() {
  const { alerts, loading: alertsLoading, counts } = useAlerts();
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(true);

  const stored = localStorage.getItem("user");
  const user = stored ? JSON.parse(stored) : null;

  const fetchReports = useCallback(() => {
    fetch(`${API_BASE}/api/reports`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.reports) setReports(data.reports);
      })
      .catch(() => {})
      .finally(() => setReportsLoading(false));
  }, []);

  useEffect(() => {
    fetchReports();

    const socket = connectSocket();
    socket.on("new_emergency_report", fetchReports);
    socket.on("report_updated", fetchReports);

    return () => {
      socket.off("new_emergency_report", fetchReports);
      socket.off("report_updated", fetchReports);
    };
  }, [fetchReports]);

  const visibleModules = modules;
  const pendingReports = reports.filter(
    (r) => (r.status || "pending") === "pending",
  );
  const recentAlerts = alerts.slice(0, 5);
  const recentPending = pendingReports.slice(0, 4);
  const newAlertsToday = alerts.filter((a) => {
    if (!a.createdAt) return false;
    return new Date(a.createdAt).toDateString() === new Date().toDateString();
  }).length;

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard Overview</h1>
        <p className="text-gray-500 mt-1 text-sm">
          {user?.name ? `Welcome back, ${user.name}` : "Welcome"} — Antipolo
          City CDRRMO
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-5 mb-6">
        {/* Active Alerts */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-6">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-widest text-gray-500">
              Active Alerts
            </p>
            <Bell size={16} className="text-gray-300" />
          </div>
          {alertsLoading ? (
            <div className="h-8 w-10 bg-gray-100 rounded animate-pulse" />
          ) : (
            <p className="text-2xl sm:text-4xl font-bold font-mono text-gray-900">
              {counts.total}
            </p>
          )}
          {newAlertsToday > 0 && (
            <p className="text-[10px] sm:text-xs text-blue-600 mt-2 sm:mt-3 flex items-center gap-1">
              <TrendingUp size={13} />
              {newAlertsToday} new today
            </p>
          )}
        </div>

        {/* Pending Reports */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-6 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-widest text-gray-500">
              Pending Reports
            </p>
            <Clock size={16} className="text-gray-300" />
          </div>
          {reportsLoading ? (
            <div className="h-8 w-10 bg-gray-100 rounded animate-pulse" />
          ) : (
            <p
              className={`text-2xl sm:text-4xl font-bold font-mono ${
                pendingReports.length > 0 ? "text-amber-600" : "text-gray-900"
              }`}
            >
              {pendingReports.length}
            </p>
          )}
          <p className="text-[10px] sm:text-xs text-gray-500 mt-2 sm:mt-3">
            {pendingReports.length > 0 ? "Awaiting review" : "Nothing pending"}
          </p>
        </div>
      </div>

      {/* Live Feeds */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
        {/* Recent Alerts */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col min-h-[320px]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">
              Recent Alerts
            </h2>
            <Link
              to="/alerts"
              aria-label="View all alerts"
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              View all <ArrowRight size={13} />
            </Link>
          </div>

          <div className="flex-1 divide-y divide-gray-50">
            {alertsLoading ? (
              Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
            ) : recentAlerts.length === 0 ? (
              <AllClearState label="No active alerts — situation is clear" />
            ) : (
              recentAlerts.map((alert) => {
                const leftBorder =
                  ALERT_LEFT_BORDER[alert.severity] ?? "border-l-gray-200";
                const badge =
                  ALERT_BADGE[alert.severity] ?? "bg-gray-100 text-gray-600";
                const label = ALERT_LABEL[alert.severity] ?? alert.severity;
                return (
                  <div
                    key={alert._id}
                    className={`px-5 py-3.5 flex items-start gap-3 border-l-4 ${leftBorder}`}
                  >
                    <span
                      className={`mt-0.5 shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${badge}`}
                    >
                      {label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate leading-snug">
                        {alert.title}
                      </p>
                      <p className="text-[11px] text-gray-500 mt-0.5 font-mono capitalize">
                        {alert.type} · {timeAgo(alert.updatedAt ?? alert.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Pending Reports Feed */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col min-h-[320px]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">
              Pending Reports
            </h2>
            <Link
              to="/reports"
              aria-label="View all reports"
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              View all <ArrowRight size={13} />
            </Link>
          </div>

          <div className="flex-1 divide-y divide-gray-50">
            {reportsLoading ? (
              Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
            ) : recentPending.length === 0 ? (
              <AllClearState label="No pending reports — all reviewed" />
            ) : (
              recentPending.map((report) => {
                const type = report.emergencyType
                  ? report.emergencyType.charAt(0).toUpperCase() +
                    report.emergencyType.slice(1)
                  : "Report";
                const location =
                  report.location?.exactAddress ||
                  report.location ||
                  "Unknown location";
                const reporter =
                  report.userData?.fullName || report.userName || "Anonymous";
                return (
                  <div
                    key={report._id || report.id}
                    className="px-5 py-3.5 flex items-start gap-3 border-l-4 border-l-amber-400"
                  >
                    <span className="mt-0.5 shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide bg-amber-50 text-amber-800 border border-amber-200">
                      {type}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate leading-snug">
                        {location}
                      </p>
                      <p className="text-[11px] text-gray-500 mt-0.5 font-mono flex items-center gap-1">
                        {reporter} · {timeAgo(report.timestamp)}
                        {new Date(report.timestamp).toDateString() === new Date().toDateString() && (
                          <TrendingUp size={11} className="text-blue-400" />
                        )}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Quick Access */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-500 mb-4">
          Quick Access
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-5">
          {visibleModules.map((module) => (
            <DashboardCard key={module.href} {...module} />
          ))}
        </div>
      </div>
    </div>
  );
}
