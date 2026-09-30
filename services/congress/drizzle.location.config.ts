import { defineConfig } from "drizzle-kit";

// The Location connector's cache DB (see src/connectors/location/db).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/connectors/location/db/schema.ts",
  out: "./src/connectors/location/db/migrations",
  dbCredentials: {
    url: "./data/connectors/location.sqlite3",
  },
});
