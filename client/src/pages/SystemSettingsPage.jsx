import { Settings } from "lucide-react";

// Minimal placeholder — no concrete system settings were specified for this
// role restructuring effort. System Admin can already reach this page;
// specific settings (rate limits, alert thresholds, etc.) are future work.
export default function SystemSettingsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">System Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Platform-wide configuration.</p>
      </div>

      <div className="text-center py-16 bg-white rounded-xl border border-gray-200 text-gray-500 text-sm">
        <Settings className="mx-auto mb-2 text-gray-300" size={28} />
        No configurable settings yet.
      </div>
    </div>
  );
}
