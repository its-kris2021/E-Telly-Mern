import Sidebar from "../components/admin/Sidebar";
import Header from "../components/admin/Header";

// Pass userEmail + onLogout from your auth context once implemented
export default function AdminLayout({ children, userEmail, onLogout }) {
  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar — fixed, 256px wide */}
      <Sidebar />

      {/* Main content — offset by sidebar width on large screens */}
      <div className="flex flex-col flex-1 lg:ml-64 min-h-screen overflow-x-hidden">
        <Header userEmail={userEmail} onLogout={onLogout} />
        {/* scrollbar-gutter reserves the scrollbar's width up front, so
            pages that start short (e.g. a loading spinner) and then grow
            tall once data arrives don't cause a horizontal layout shift
            when the scrollbar appears. */}
        <main className="flex-1 p-4 sm:p-6 overflow-y-auto [scrollbar-gutter:stable]">{children}</main>
      </div>
    </div>
  );
}
