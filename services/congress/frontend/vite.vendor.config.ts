import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

// Builds the one shared copy of react/react-dom/react-router-dom/
// @tanstack/react-query (+ both JSX runtimes) that Capitol's own app and
// every dynamically-loaded Chamber remote entry resolve through the
// importmap in index.html, instead of each bundling its own copy. This is
// what lets a lazily-mounted Chamber component share React's internal
// module state (hooks dispatcher, context) with the shell tree it renders
// into - two separate bundled copies of "the same" React version would
// still crash with "invalid hook call". Six inputs so each package keeps
// its own real export surface (no risk of an `export *` name collision
// silently dropping something, e.g. "Fragment" exists on both react and
// react/jsx-runtime); Rollup still factors their shared internals into one
// common chunk, so there's exactly one live React module underneath all six.
export default defineConfig({
  root,
  build: {
    outDir: "dist/vendor",
    emptyOutDir: false,
    rollupOptions: {
      input: {
        react: fileURLToPath(new URL("./src/vendor/react.ts", import.meta.url)),
        "react-dom": fileURLToPath(new URL("./src/vendor/react-dom.ts", import.meta.url)),
        "react-dom-client": fileURLToPath(new URL("./src/vendor/react-dom-client.ts", import.meta.url)),
        "react-router-dom": fileURLToPath(new URL("./src/vendor/react-router-dom.ts", import.meta.url)),
        "react-query": fileURLToPath(new URL("./src/vendor/react-query.ts", import.meta.url)),
        "jsx-runtime": fileURLToPath(new URL("./src/vendor/jsx-runtime.ts", import.meta.url)),
      },
      // Vite's app-build default (preserveEntrySignatures: false) lets
      // Rollup drop an entry chunk's exports when nothing *inside this
      // build* consumes them - which is everything here, since these six
      // chunks exist purely to be imported by other, separate builds
      // (Capitol's main bundle, every Chamber's remote entry) via the
      // importmap. "strict" forces every export each wrapper re-exports to
      // actually survive onto the output chunk.
      preserveEntrySignatures: "strict",
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "chunk-[hash].js",
      },
    },
  },
});
