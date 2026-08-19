import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, useState, useEffect } from "react";
import AdminLayout from "./layouts/AdminLayout";
import InstallPrompt from "./components/pwa/InstallPrompt";

const LoginPage = lazy(() => import("./pages/LoginPage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ChangePasswordPage = lazy(() => import("./pages/ChangePasswordPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const AlertsPage = lazy(() => import("./pages/AlertsPage"));
const HazardMapPage = lazy(() => import("./pages/HazardMapPage"));
const EvacuationPage = lazy(() => import("./pages/EvacuationPage"));
const ManageUsersPage = lazy(() => import("./pages/ManageUsersPage"));
const ReportsPage = lazy(() => import("./pages/ReportPage"));
const SafetyTipsPage = lazy(() => import("./pages/SafetyTipsPage"));
const SafetyTipDetailPage = lazy(() => import("./pages/SafetyTipDetailPage"));
const ChatMonitoringPage = lazy(() => import("./pages/ChatMonitoringPage"));
const AuditLogsPage = lazy(() => import("./pages/AuditLogsPage"));
const ModelPerformancePage = lazy(() => import("./pages/ModelPerformancePage"));
import { getUserRole, getHomePath, ROLE_HOME, ROLE_NAV_ITEMS } from "./config/roleModules";

function clearSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

// ── Token validation ───────────────────────────────────────────────────────────
// Checks presence AND expiry of the JWT, AND that the cached role still maps
// to a known home page. That last check matters whenever the role model
// changes (e.g. a role gets renamed/split): a browser with a still-valid but
// now-unrecognized cached role would otherwise get treated as "logged in"
// with nowhere to go, which sends PublicRoute into a /login → /login redirect
// loop. Clearing the stale session here makes every guard just fall through
// to the login page instead.
function isTokenValid() {
  const token = localStorage.getItem("token");
  if (!token) return false;

  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    // exp is in seconds; Date.now() is in milliseconds
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      clearSession();
      return false;
    }
  } catch {
    clearSession();
    return false;
  }

  const role = getUserRole();
  if (role && !(role in ROLE_HOME)) {
    // Stale/unrecognized role (e.g. cached before a role rename) — treat as
    // logged out rather than looping trying to find a home for it.
    clearSession();
    return false;
  }

  return true;
}

// ── Route guards ──────────────────────────────────────────────────────────────

// Redirect to the caller's role-appropriate home if already logged in (e.g. hitting /login again)
function PublicRoute({ children }) {
  return isTokenValid() ? (
    <Navigate to={getHomePath(getUserRole())} replace />
  ) : (
    children
  );
}

// Redirect to login if NOT logged in or token expired
function ProtectedRoute({ children }) {
  return isTokenValid() ? children : <Navigate to="/login" replace />;
}

// Redirect away if the logged-in role isn't permitted for this route
function RoleGate({ roles, children }) {
  if (!roles) return children;
  const role = getUserRole();
  return roles.includes(role) ? children : <Navigate to={getHomePath(role)} replace />;
}

// Auth required but no AdminLayout — used for /change-password
function AuthOnlyRoute({ Page }) {
  return isTokenValid() ? <Page /> : <Navigate to="/login" replace />;
}

// ── Session expiry warning banner ─────────────────────────────────────────────
function SessionExpiryBanner() {
  const [minutesLeft, setMinutesLeft] = useState(null);

  useEffect(() => {
    function check() {
      const token = localStorage.getItem("token");
      if (!token) return setMinutesLeft(null);
      try {
        const { exp } = JSON.parse(atob(token.split(".")[1]));
        if (!exp) return setMinutesLeft(null);
        const mins = Math.floor((exp * 1000 - Date.now()) / 60000);
        setMinutesLeft(mins <= 30 && mins > 0 ? mins : null);
      } catch {
        setMinutesLeft(null);
      }
    }
    check();
    const id = setInterval(check, 60000);
    return () => clearInterval(id);
  }, []);

  if (minutesLeft === null) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-amber-500 text-white text-sm font-medium px-4 py-2 flex items-center justify-between shadow-md">
      <span>Your session expires in {minutesLeft} minute{minutesLeft !== 1 ? "s" : ""}. Save your work and log in again to continue.</span>
      <a
        href="/login"
        onClick={() => { localStorage.removeItem("token"); localStorage.removeItem("user"); }}
        className="ml-4 underline font-bold whitespace-nowrap hover:text-amber-100"
      >
        Log in again
      </a>
    </div>
  );
}

// ── Layout wrapper (moved outside App to prevent remounts on re-render) ───────
// `roles` (optional array) restricts this route to specific roles; anyone else
// is bounced to their own role's home page.
function ProtectedLayout({ Page, roles }) {
  const userEmail = localStorage.getItem("user")
    ? JSON.parse(localStorage.getItem("user")).email
    : "";

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  };

  return (
    <ProtectedRoute>
      <RoleGate roles={roles}>
        <SessionExpiryBanner />
        <AdminLayout userEmail={userEmail} onLogout={handleLogout}>
          <Page />
        </AdminLayout>
      </RoleGate>
    </ProtectedRoute>
  );
}

// Roles allowed on a given path, derived from the single source of truth
// (roleModules.js ROLE_NAV_ITEMS) instead of a second hand-maintained list —
// keeps route access and sidebar nav visibility from drifting apart.
function rolesFor(path) {
  return Object.keys(ROLE_NAV_ITEMS).filter((role) =>
    ROLE_NAV_ITEMS[role].some((item) => item.href === path),
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <InstallPrompt />
      <Suspense fallback={<div className="p-6 text-slate-600">Loading...</div>}>
      <Routes>
        {/* Root → login, or the caller's role home if already authenticated */}
        <Route
          path="/"
          element={
            <Navigate
              to={isTokenValid() ? getHomePath(getUserRole()) : "/login"}
              replace
            />
          }
        />

        {/* Public — redirect to dashboard if already authenticated */}
        <Route
          path="/login"
          element={
            <PublicRoute>
              <LoginPage />
            </PublicRoute>
          }
        />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        {/* Auth required, no sidebar layout */}
        <Route
          path="/change-password"
          element={<AuthOnlyRoute Page={ChangePasswordPage} />}
        />

        {/* Protected pages — disaster-response ops (CDRRMO + Barangay Official) */}
        <Route
          path="/dashboard"
          element={<ProtectedLayout Page={DashboardPage} roles={rolesFor("/dashboard")} />}
        />
        <Route
          path="/alerts"
          element={<ProtectedLayout Page={AlertsPage} roles={rolesFor("/alerts")} />}
        />
        <Route
          path="/reports"
          element={<ProtectedLayout Page={ReportsPage} roles={rolesFor("/reports")} />}
        />
        <Route
          path="/hazard-map"
          element={<ProtectedLayout Page={HazardMapPage} roles={rolesFor("/hazard-map")} />}
        />
        <Route
          path="/evacuation"
          element={<ProtectedLayout Page={EvacuationPage} roles={rolesFor("/evacuation")} />}
        />
        <Route
          path="/safety-tips"
          element={<ProtectedLayout Page={SafetyTipsPage} roles={rolesFor("/safety-tips")} />}
        />
        {/* Detail page has no nav entry of its own — inherits the list page's roles */}
        <Route
          path="/safety-tips/:slug"
          element={<ProtectedLayout Page={SafetyTipDetailPage} roles={rolesFor("/safety-tips")} />}
        />
        <Route
          path="/chat-monitoring"
          element={<ProtectedLayout Page={ChatMonitoringPage} roles={rolesFor("/chat-monitoring")} />}
        />

        {/* Protected pages — System Admin (web-platform/account management, zero ops access) */}
        <Route
          path="/manage-users"
          element={<ProtectedLayout Page={ManageUsersPage} roles={rolesFor("/manage-users")} />}
        />
        <Route
          path="/audit-logs"
          element={<ProtectedLayout Page={AuditLogsPage} roles={rolesFor("/audit-logs")} />}
        />
        <Route
          path="/model-performance"
          element={<ProtectedLayout Page={ModelPerformancePage} roles={rolesFor("/model-performance")} />}
        />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
