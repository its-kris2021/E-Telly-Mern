import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Check, X as XIcon, Lock } from "lucide-react";
import { getHomePath } from "../config/roleModules";

const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? `http://${window.location.hostname}:5000`);

function checkStrength(pw) {
  return {
    length: pw.length >= 8,
    uppercase: /[A-Z]/.test(pw),
    lowercase: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw),
    special: /[!@#$%^&*()\-_=+[\]{};':"\\|,.<>/?`~]/.test(pw),
  };
}

function StrengthItem({ ok, label }) {
  return (
    <li
      className={`flex items-center gap-2 text-sm transition-colors ${
        ok ? "text-green-600" : "text-gray-400"
      }`}
    >
      {ok ? (
        <Check size={13} className="shrink-0" />
      ) : (
        <XIcon size={13} className="shrink-0 text-gray-300" />
      )}
      {label}
    </li>
  );
}

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const checks = checkStrength(newPassword);
  const allPassed = Object.values(checks).every(Boolean);
  const passwordsMatch = newPassword === confirmPassword;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!allPassed) return setError("Password does not meet all requirements.");
    if (!passwordsMatch) return setError("Passwords do not match.");

    setIsLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(
        `${API_BASE}/api/auth/change-password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ newPassword }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);

      // Clear the flag from the locally stored user
      const stored = JSON.parse(localStorage.getItem("user") || "{}");
      localStorage.setItem(
        "user",
        JSON.stringify({ ...stored, mustChangePassword: false }),
      );

      navigate(getHomePath(stored.role));
    } catch (err) {
      setError(err.message || "Failed to change password.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-red-950 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-10">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Lock size={28} className="text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Set your password</h2>
          <p className="text-gray-500 mt-2 text-sm leading-relaxed">
            Your account requires a new password before you can continue.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* New password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              New Password
            </label>
            <div className="relative">
              <input
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setError("");
                }}
                className="w-full px-4 py-3 pr-11 rounded-xl border border-gray-200 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="Enter new password"
                required
                disabled={isLoading}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowNew((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {showNew ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Strength checklist */}
          {newPassword.length > 0 && (
            <ul className="grid grid-cols-2 gap-2 bg-gray-50 border border-gray-100 rounded-xl p-4">
              <StrengthItem ok={checks.length} label="At least 8 characters" />
              <StrengthItem ok={checks.uppercase} label="Uppercase letter" />
              <StrengthItem ok={checks.lowercase} label="Lowercase letter" />
              <StrengthItem ok={checks.number} label="Number" />
              <StrengthItem ok={checks.special} label="Special character" />
            </ul>
          )}

          {/* Confirm password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Confirm Password
            </label>
            <div className="relative">
              <input
                type={showConfirm ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setError("");
                }}
                className={`w-full px-4 py-3 pr-11 rounded-xl border bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors ${
                  confirmPassword && !passwordsMatch
                    ? "border-red-400 bg-red-50"
                    : "border-gray-200"
                }`}
                placeholder="Repeat new password"
                required
                disabled={isLoading}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {confirmPassword && !passwordsMatch && (
              <p className="text-xs text-red-500 mt-1.5">
                Passwords do not match
              </p>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !allPassed || !passwordsMatch}
            className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLoading ? "Updating…" : "Set New Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
