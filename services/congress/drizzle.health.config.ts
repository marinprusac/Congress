import { defineConfig } from "drizzle-kit";

// The Health connector's cache DB (see src/connectors/health/db).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/connectors/health/db/schema.ts",
  out: "./src/connectors/health/db/migrations",
  dbCredentials: {
    url: "./data/connectors/health.sqlite3",
  },
});
