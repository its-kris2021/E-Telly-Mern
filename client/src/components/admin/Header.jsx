import { useState } from "react";
import { User, LogOut, MapPin } from "lucide-react";
import { useNavigate } from "react-router-dom";
import NotificationToggle from "../pwa/NotificationToggle";
import { ROLE_LABELS, getUserRole, getAssignedBarangay } from "../../config/roleModules";
import { barangayLabel } from "../../config/barangays";

export default function Header({ userEmail = "", onLogout }) {
  const navigate = useNavigate();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const userRole = getUserRole();
  const roleLabel = ROLE_LABELS[userRole] || "User";
  const assignedBarangay = getAssignedBarangay();
  const barangayName = assignedBarangay ? barangayLabel(assignedBarangay) : null;

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    if (onLogout) onLogout();

    setShowLogoutConfirm(false);

    navigate("/login", { replace: true });
  };

  return (
    <>
      <header className="bg-white border-b border-gray-200 pl-14 pr-6 py-4 lg:px-6">
        <div className="flex items-center justify-between">
          <div className="flex-1 max-w-md" />

          <div className="flex items-center gap-4">
            <NotificationToggle />

            {barangayName && (
              <span className="hidden md:inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-medium border border-blue-200">
                <MapPin size={12} />
                Brgy. {barangayName}
              </span>
            )}

            {/* User info */}
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium">
                  {userEmail || "Admin User"}
                </p>
                <p className="text-xs text-gray-500">{roleLabel}</p>
              </div>
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <User size={20} className="text-blue-600" />
              </div>
            </div>

            {/* Logout button */}
            <button
              onClick={() => setShowLogoutConfirm(true)}
              className="flex items-center gap-2 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm font-medium"
              title="Logout"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Logout Confirmation Modal
          z-[2000] is intentional — Leaflet's controls sit at z-index 1000,
          its panes at 200-600. We must be above all of them. */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 backdrop-blur-sm bg-black/30 flex items-center justify-center z-[2000]">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold mb-2">Confirm Logout</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to logout?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
