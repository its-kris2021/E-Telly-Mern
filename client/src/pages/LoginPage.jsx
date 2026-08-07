import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Eye, EyeOff, Shield } from "lucide-react";
import antipoloImg from "../images/antipolo.jpg";
import logoImg from "../images/logtell1.png";
import { getHomePath } from "../config/roleModules";

const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? "http://localhost:5000");

export default function LoginPage() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Incorrect username or password");
        setIsLoading(false);
      } else if (data.user.role === "user") {
        setError("Access denied. This portal is for CDRRMO staff and Barangay Officials only. Please use the E-Telly mobile app.");
        setIsLoading(false);
      } else {
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));

        if (data.user.mustChangePassword) {
          navigate("/change-password");
        } else {
          navigate(getHomePath(data.user.role));
        }
      }
    } catch {
      setError("An error occurred during login");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-stretch">
      {/* Background */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${antipoloImg})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-br from-black/75 via-black/60 to-red-950/60" />

      {/* Left — Branding (desktop) */}
      <div className="relative hidden lg:flex lg:w-1/2 xl:w-3/5 flex-col items-center justify-center p-16 text-white">
        <img
          src={logoImg}
          alt="E-Telly Logo"
          className="w-28 h-32 mb-6 drop-shadow-2xl"
        />
        <h1 className="text-5xl font-black tracking-tight mb-4">E-TELLY</h1>
        <p className="text-xl text-white/75 text-center max-w-sm leading-relaxed">
          Disaster preparedness and community resource sharing
        </p>
        <div className="mt-12 flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-5 py-2.5 text-sm text-white/70">
          <Shield size={14} />
          Antipolo City CDRRMO
        </div>
      </div>

      {/* Right — Login form */}
      <div className="relative flex w-full lg:w-1/2 xl:w-2/5 min-h-screen items-center justify-center p-6">
        <div className="bg-white/95 backdrop-blur-md rounded-3xl shadow-2xl w-full max-w-md p-10">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <img
              src={logoImg}
              alt="E-Telly Logo"
              className="w-16 h-20 mx-auto mb-3"
            />
            <h1 className="text-2xl font-black text-gray-900">E-TELLY</h1>
          </div>

          <div className="mb-8">
            <h2 className="text-3xl font-bold text-gray-900">Welcome back</h2>
            <p className="text-gray-500 mt-1.5 text-sm">
              Sign in to your account to continue
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email address
              </label>
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => {
                  setLoginEmail(e.target.value);
                  setError("");
                }}
                className={`w-full px-4 py-3 rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                  error
                    ? "bg-red-50 border-red-400"
                    : "bg-gray-50 border-gray-200 hover:border-gray-300"
                }`}
                placeholder="you@example.com"
                required
                disabled={isLoading}
                autoComplete="email"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={loginPassword}
                  onChange={(e) => {
                    setLoginPassword(e.target.value);
                    setError("");
                  }}
                  className={`w-full px-4 py-3 pr-11 rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    error
                      ? "bg-red-50 border-red-400"
                      : "bg-gray-50 border-gray-200 hover:border-gray-300"
                  }`}
                  placeholder="••••••••"
                  required
                  disabled={isLoading}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            {/* Forgot password */}
            <div className="text-right">
              <Link
                to="/forgot-password"
                className="text-sm text-red-600 hover:text-red-700 font-medium"
              >
                Forgot password?
              </Link>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
            >
              {isLoading ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Signing in…
                </>
              ) : (
                "Sign In"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
