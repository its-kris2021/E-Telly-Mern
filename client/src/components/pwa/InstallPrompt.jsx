import { useState, useEffect } from "react";
import { Download, X } from "lucide-react";

export default function InstallPrompt() {
  const [prompt, setPrompt] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setPrompt(e);
      setVisible(true);
    };

    // Hide banner however the app gets installed — address bar button, our button, etc.
    const onInstalled = () => setVisible(false);

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") setVisible(false);
  };

  if (!visible) return null;

  // Detect mobile so we can adjust the description copy
  const isMobile = /Mobi|Android/i.test(navigator.userAgent);

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] w-[calc(100%-2rem)] max-w-sm">
      <div className="bg-slate-800 text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3">
        <img src="/icons/icon.png" alt="E-Telly" className="w-10 h-10 rounded-xl flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight">Install E-Telly</p>
          <p className="text-xs text-slate-400 leading-tight mt-0.5">
            {isMobile
              ? "Add to home screen for quick access"
              : "Install as a standalone app for faster access"}
          </p>
        </div>
        <button
          onClick={install}
          className="flex-shrink-0 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
        >
          <Download size={12} />
          Install
        </button>
        <button
          onClick={() => setVisible(false)}
          aria-label="Dismiss install prompt"
          className="flex-shrink-0 text-slate-400 hover:text-white transition-colors"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
