import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      includeAssets: ["icons/icon.png", "icons/icon-192.png"],
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
});
