import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, ChevronLeft } from "lucide-react";
import { ROLE_NAV_ITEMS, ROLE_LABELS, getUserRole } from "../../config/roleModules";

export default function Sidebar() {
  const { pathname } = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  const userRole = getUserRole();
  const visibleMenuItems = ROLE_NAV_ITEMS[userRole] || [];
  const roleLabel = ROLE_LABELS[userRole] || "Portal";

  return (
    <>
      {/* Mobile menu button — only when sidebar is closed */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="lg:hidden fixed top-4 left-4 z-[1300] p-2 rounded-md bg-white shadow-lg"
        >
          <Menu size={24} />
        </button>
      )}

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-[1100]"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={[
          "fixed top-0 left-0 z-[1200] h-screen transition-transform lg:translate-x-0",
          "w-64 bg-white border-r border-gray-200",
          isOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="h-full px-3 py-4 overflow-y-auto">
          {/* Logo */}
          <div className="mb-8 px-3 flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-red-600">E-Telly</h1>
              <p className="text-xs text-gray-500 mt-1">{roleLabel}</p>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="lg:hidden p-1 rounded-md hover:bg-gray-100 text-gray-600 mt-0.5"
            >
              <ChevronLeft size={20} />
            </button>
          </div>

          {/* Navigation */}
          <nav className="space-y-2">
            {visibleMenuItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setIsOpen(false)}
                  className={[
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm",
                    isActive
                      ? "bg-blue-50 text-red-600 font-medium"
                      : "text-gray-700 hover:bg-gray-50",
                  ].join(" ")}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>
    </>
  );
}
