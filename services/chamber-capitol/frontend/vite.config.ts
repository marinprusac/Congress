import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const PROXY_TARGET = "http://127.0.0.1:8015";
// Exhibit search/resolve/backlinks go straight to Congress, not this
// Chamber's own backend - in prod this resolves same-origin through
// Congress's proxy automatically, so only dev needs an explicit target.
const CONGRESS_PROXY_TARGET = "http://127.0.0.1:3000";
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ command }) => ({
  root,
  // In production this Chamber's frontend is proxied through Congress at
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
      "/congress": CONGRESS_PROXY_TARGET,
    },
  },
  build: {
    rollupOptions: {
      // Capitol's canvas dynamically imports other Chambers' remote-entry.js
      // bundles to mount their widgets (see Canvas.tsx) - those are built
      // external to these same packages and resolved at runtime against the
      // shared vendor build via index.html's importmap. Capitol's own
      // bundle has to resolve the same way, even when it's the one being
      // loaded directly (a hard refresh at /capitol, not shell-hosted
      // inside Congress) - otherwise Capitol's own React tree and any
      // widget it mounts end up on two different copies of React, which
      // breaks hooks. Only affects `vite build` - `vite dev` ignores
      // rollupOptions entirely and keeps resolving these normally from
      // node_modules, same as every other Chamber's dev server.
      external: ["react", "react-dom", "react-dom/client", "react-router-dom", "@tanstack/react-query", "react/jsx-runtime"],
    },
  },
}));
