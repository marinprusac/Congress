import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL(".", import.meta.url));

// Builds src/remote.tsx as a standalone ES module - the artifact Capitol's
// shell (ChamberHost) dynamically imports to host this Chamber in-page
// instead of navigating to it. Separate from the normal build:web output
// (vite.config.ts, unchanged, still fully self-contained for standalone/dev
// use): react/react-dom/react-router-dom/@tanstack/react-query, plus
// @congress/congress-ui itself, are left external here and resolved at
// runtime against Capitol's shared vendor build via the importmap in its
// index.html - see that file and
// services/congress/frontend/vite.vendor.config.ts for why. Run after
// build:web (emptyOutDir: false, so it doesn't wipe that output - the two
// share one dist/).
export default defineConfig({
  root,
  base: "/tasks/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // This build's own CSS graph should skip re-emitting the fonts +
      // hand-written component classes congress-ui/styles.css normally
      // pulls in (shared.css) - Congress's shell always has a full copy
      // already loaded by the time this remote entry mounts into it. See
      // congress-ui/src/styles.remote.css's own comment.
      "@congress/congress-ui/styles.css": fileURLToPath(
        new URL("../../../packages/congress-ui/src/styles.remote.css", import.meta.url)
      ),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: fileURLToPath(new URL("./src/remote.tsx", import.meta.url)),
      external: [
        "react",
        "react-dom",
        "react-dom/client",
        "react-router-dom",
        "@tanstack/react-query",
        "react/jsx-runtime",
        "@congress/congress-ui",
      ],
      // Vite's app-build default (preserveEntrySignatures: false) lets
      // Rollup tree-shake this entry's default export away entirely, since
      // nothing *in this build* consumes it - it's meant for Capitol's
      // shell to import at runtime, in a completely separate build. Without
      // this, the whole component tree gets silently dropped (confirmed by
      // testing: the output was ~64kB of unrelated leftover code with zero
      // `export` statements).
      preserveEntrySignatures: "strict",
      output: {
        format: "es",
        entryFileNames: "remote-entry.js",
        chunkFileNames: "assets/remote-chunk-[hash].js",
        // A fixed name for the one CSS file this graph emits, so ChamberHost
        // can reference it directly without needing to look up a hash.
        // Everything else (fonts, etc.) keeps normal hashed asset naming,
        // shared/deduped with build:web's own output by content hash.
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith(".css") ? "remote-entry.css" : "assets/[name]-[hash][extname]",
      },
    },
  },
});
