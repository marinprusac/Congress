import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const PROXY_TARGET = "http://127.0.0.1:8015";
// Exhibit search/resolve/backlinks go straight to Capitol, not this
// Chamber's own backend - in prod this resolves same-origin through
// Capitol's proxy automatically, so only dev needs an explicit target.
const CAPITOL_PROXY_TARGET = "http://127.0.0.1:3000";
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ command }) => ({
  root,
  // In production this Chamber's frontend is proxied through Capitol at
  // "/capitol/*" (see services/congress/src/gateway.ts), so built
  // asset URLs must carry that prefix. The dev server still runs standalone
  // at "/".
  base: command === "build" ? "/capitol/" : "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": PROXY_TARGET,
      "/manifest": PROXY_TARGET,
      "/health": PROXY_TARGET,
      "/mcp": PROXY_TARGET,
      "/capitol": CAPITOL_PROXY_TARGET,
    },
  },
}));
