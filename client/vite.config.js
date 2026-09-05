import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Default "auto" injects <script src="/registerSW.js"> with no
      // defer/async, which blocks HTML parsing until it's fetched and
      // competes with the main JS bundle for one of HTTP/1.1's 6
      // connections-per-host slots. "inline" writes the ~10-line
      // registration snippet directly into index.html instead.
      injectRegister: "inline",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      includeAssets: ["icons/icon.png", "icons/icon-192.png"],
      injectManifest: {
        // Default globPatterns (**/*.{js,css,html}) precaches every lazy
        // route chunk on first install — ~14 pages' worth of JS/CSS
        // downloaded up front, competing with the current page's own
        // requests for HTTP/1.1's 6-connections-per-host limit. Excluding
        // per-route chunks keeps the app shell (main bundle, vendor-icons,
        // shared components) precached for instant offline boot, while each
        // page is instead cached at runtime the first time it's actually
        // visited (see the StaleWhileRevalidate route in src/sw.js).
        globIgnores: [
          "assets/LoginPage-*",
          "assets/ForgotPasswordPage-*",
          "assets/ChangePasswordPage-*",
          "assets/DashboardPage-*",
          "assets/AlertsPage-*",
          "assets/HazardMapPage-*",
          "assets/EvacuationPage-*",
          "assets/ManageUsersPage-*",
          "assets/ReportPage-*",
          "assets/SafetyTipsPage-*",
          "assets/SafetyTipDetailPage-*",
          "assets/ChatMonitoringPage-*",
          "assets/AuditLogsPage-*",
          "assets/ModelPerformancePage-*",
          "assets/ModelPerformancePanel-*",
        ],
      },
      manifest: {
        name: "E-Telly: Disaster Preparedness & Resource Sharing",
        short_name: "E-Telly",
        description:
          "Smart disaster preparedness, real-time hazard alerts, and community resource sharing for Antipolo City.",
        start_url: "/dashboard",
        display: "standalone",
        orientation: "any",
        theme_color: "#1e293b",
        background_color: "#1e293b",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
        categories: ["utilities", "productivity"],
        lang: "en-PH",
      },
    }),
  ],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: ["leaflet"],
    exclude: ["leaflet.heat"],
  },
  build: {
    rollupOptions: {
      output: {
        // Each lucide-react icon used across 2+ lazy routes otherwise lands
        // in its own ~150-2000 byte chunk (Rollup's default shared-chunk
        // extraction). On HTTP/1.1 (Heroku's herokuapp.com domain can't do
        // HTTP/2) that's a dozen-plus extra requests competing for the
        // browser's 6-connections-per-host cap on every route. One shared,
        // long-cached vendor chunk trades that for a single request.
        manualChunks(id) {
          if (id.includes("node_modules/lucide-react")) return "vendor-icons";
        },
      },
    },
  },
});
