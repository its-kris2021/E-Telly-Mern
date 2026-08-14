import { Link, useSearchParams } from "react-router-dom";
import { Phone, Mail, ArrowLeft, KeyRound } from "lucide-react";

const SYSTEM_ADMIN_EMAIL = "rafael@etelly.com";

export default function ForgotPasswordPage() {
  const [searchParams] = useSearchParams();
  const email = (searchParams.get("email") || "").trim().toLowerCase();
  const isSystemAdmin = email === SYSTEM_ADMIN_EMAIL;

  const description = isSystemAdmin
    ? "As the System Administrator, you're the one who resets passwords for everyone else — there's no administrator above your account to do it for you. Recovery has to be done directly by E-Telly technical support."
    : "The System Administrator can reset it for you. Once reset, you will be given a temporary password and prompted to create a new one.";

  const steps = isSystemAdmin
    ? [
        "Contact E-Telly technical support",
        "Verify your identity as the System Administrator",
        "They will manually reset your password on the server",
        "Log in and set your own strong password",
      ]
    : [
        "Contact the System Administrator",
        "Ask them to reset your account password",
        "They will give you a temporary password",
        "Log in and set your own strong password",
      ];

  const contactLabel = isSystemAdmin
    ? "Contact technical support"
    : "Contact System Administrator";

  const officeLabel = "System Admin";
  const phone = "+63 917 000 0000";
  const contactEmail = "rafael@etelly.com";

  return (
    <div className="min-h-screen relative flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-gray-900" />
      <div className="absolute inset-0 bg-gradient-to-br from-black/75 via-black/60 to-red-950/60" />

      <div className="relative bg-white/95 backdrop-blur-md rounded-3xl shadow-2xl w-full max-w-md p-10">
        {/* Icon + heading */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <KeyRound size={28} className="text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">
            Forgot your password?
          </h2>
          <p className="text-gray-500 mt-2 text-sm leading-relaxed">
            {description}
          </p>
        </div>

        {/* Steps */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6">
          <p className="text-sm font-semibold text-amber-800 mb-3">
            How it works
          </p>
          <ol className="space-y-2">
            {steps.map((step, i) => (
              <li
                key={i}
                className="flex items-start gap-3 text-sm text-amber-700"
              >
                <span className="w-5 h-5 rounded-full bg-amber-200 text-amber-800 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>

        {/* Contact info */}
        <div className="space-y-3 mb-8">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            {contactLabel}
          </p>
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
            <div className="w-9 h-9 bg-red-100 rounded-xl flex items-center justify-center shrink-0">
              <Phone size={15} className="text-red-600" />
            </div>
            <div>
              <p className="text-xs text-gray-400">{officeLabel}</p>
              <p className="text-sm font-semibold text-gray-900">{phone}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
            <div className="w-9 h-9 bg-red-100 rounded-xl flex items-center justify-center shrink-0">
              <Mail size={15} className="text-red-600" />
            </div>
            <div>
              <p className="text-xs text-gray-400">Email</p>
              <p className="text-sm font-semibold text-gray-900">
                {contactEmail}
              </p>
            </div>
          </div>
        </div>

        <Link
          to="/login"
          className="flex items-center justify-center gap-2 w-full py-3 border-2 border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft size={16} />
          Back to Login
        </Link>
      </div>
    </div>
  );
}
