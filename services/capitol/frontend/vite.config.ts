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
