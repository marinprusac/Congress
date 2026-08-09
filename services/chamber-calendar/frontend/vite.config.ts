import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const PROXY_TARGET = "http://127.0.0.1:8012";
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ command }) => ({
  root,
  // In production this Chamber's frontend is proxied through Capitol at
  // "/calendar/*" (see services/capitol/src/gateway.ts), so built asset URLs
  // must carry that prefix. The dev server still runs standalone at "/".
  base: command === "build" ? "/calendar/" : "/",
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
    },
  },
}));
