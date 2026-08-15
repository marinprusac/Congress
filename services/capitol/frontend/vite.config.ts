import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const PROXY_TARGET = "http://127.0.0.1:3000";
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        // Without this, the service worker's NavigationRoute serves the
        // cached Capitol app shell for every top-level navigation,
        // including "/notes" and any other Chamber path proxied through
        // server.ts's chamberFrontendProxy — silently shadowing them even
        // though the server itself proxies correctly (curl bypasses the
        // service worker, which is why this only shows up in a browser).
        // Only "/" is a real Capitol route, so only "/" gets the offline
        // app-shell fallback; everything else always hits the network.
        navigateFallbackDenylist: [/^\/(?!$)/],
      },
      manifest: {
        name: "Congress",
        short_name: "Congress",
        description: "Congress — personal operating layer",
        theme_color: "#2B4A3E",
        background_color: "#F7F6F3",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      // Resolved at runtime via the importmap in index.html against the
      // single shared copy built by vite.vendor.config.ts - see that file's
      // comment for why. Chamber remote entries share the same import map
      // (and so the same live module instances) once mounted into this
      // shell, which is the whole point.
      external: ["react", "react-dom", "react-dom/client", "react-router-dom", "@tanstack/react-query", "react/jsx-runtime"],
    },
  },
  server: {
    proxy: {
      "/capitol": PROXY_TARGET,
      "/api": PROXY_TARGET,
      "/manifest": PROXY_TARGET,
      "/health": PROXY_TARGET,
      "/mcp": PROXY_TARGET,
    },
  },
});
