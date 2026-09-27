import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Everything - this Chamber's own API included - is served by Congress,
// which runs every Chamber in its own process. Same-origin in production.
const CONGRESS_PROXY_TARGET = "http://127.0.0.1:3000";
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ command }) => ({
  root,
  // In production this Chamber's frontend is proxied through Congress at
  // "/documents/*" (see services/congress/src/gateway.ts's serveChamberAssets), so built asset URLs
  // must carry that prefix. The dev server still runs standalone at "/".
  base: command === "build" ? "/documents/" : "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": CONGRESS_PROXY_TARGET,
      "/auth": CONGRESS_PROXY_TARGET,
      "/congress": CONGRESS_PROXY_TARGET,
    },
  },
}));
