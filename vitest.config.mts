import { defineConfig } from "vitest/config";

// One root config for the whole monorepo rather than a config per service.
// Every test here is a Node-environment test (no jsdom): the frontend files
// under test are pure string helpers, and everything else is backend code.
//
// `pnpm test` runs all of it; `pnpm test services/congress` (or any path
// fragment) filters, which is what per-service test scripts would have given
// us anyway.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "packages/*/src/**/*.test.ts", "services/*/src/**/*.test.ts"],
    // Runs before each test file's own imports, which is what makes the
    // module-level `db`/`env` singletons in every service workable - see
    // packages/test-support/src/env.ts.
    setupFiles: ["packages/test-support/src/env.ts"],
    // Vitest's default, restated because the whole test-harness design leans
    // on it: each test file gets a fresh module registry, so one file's
    // opened SQLite handle and parsed env never leak into the next.
    isolate: true,
    // Several suites drive real ephemeral servers and retry chains; the
    // default 5s is tight for the slowest of them.
    testTimeout: 15_000,
  },
});
