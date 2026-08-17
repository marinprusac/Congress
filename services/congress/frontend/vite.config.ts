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
      // injectManifest (a hand-written service worker this plugin only
      // injects the precache manifest into), not the default generateSW -
      // Web Push needs its own `push`/`notificationclick` listeners
      // (src/sw.ts), which generateSW's fully-generated worker has no room
      // for. The navigateFallbackDenylist behavior generateSW used to
      // provide via config alone is now hand-written in src/sw.ts itself
      // (see that file's own comment) instead of configured here.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        // sw.ts imports from workbox-precaching/workbox-routing, which pull
        // in more of workbox-core than the precache manifest itself needs -
        // without raising this, esbuild's default budget check flags the
        // bundled worker as "too large" even though it's genuinely small.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      // Lets `dev:web` actually register/test the real service worker
      // (Web Push needs one to subscribe through) instead of only ever
      // getting one from a production build.
      devOptions: {
        enabled: true,
        type: "module",
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
      // Congress's own API (registry/settings/exhibits/sharing/...).
      "/congress": PROXY_TARGET,
      // Not Congress's own API - this is the gateway's chamber-frontend
      // proxy (forwardToChamberFrontend), needed here so dev:web can reach
      // the Capitol Chamber's static build/remote-entry the same way
      // production does. Other Chambers have the same gap in dev (no
      // equivalent "/notes", "/calendar", ... rule) - pre-existing, unrelated
      // to the Congress/Capitol split.
      "/capitol": PROXY_TARGET,
      "/api": PROXY_TARGET,
      "/manifest": PROXY_TARGET,
      "/health": PROXY_TARGET,
      "/mcp": PROXY_TARGET,
    },
  },
});
