import { defineConfig } from "drizzle-kit";

// The Hevy connector's cache DB (see src/connectors/hevy/db).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/connectors/hevy/db/schema.ts",
  out: "./src/connectors/hevy/db/migrations",
  dbCredentials: {
    url: "./data/connectors/hevy.sqlite3",
  },
});
