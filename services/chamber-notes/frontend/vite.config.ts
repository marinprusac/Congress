import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const PROXY_TARGET = "http://127.0.0.1:8011";
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
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
});
