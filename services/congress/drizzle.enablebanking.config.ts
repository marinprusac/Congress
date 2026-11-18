import { defineConfig } from "drizzle-kit";

// The Enable Banking connector's cache DB (see src/connectors/enablebanking/db).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/connectors/enablebanking/db/schema.ts",
  out: "./src/connectors/enablebanking/db/migrations",
  dbCredentials: {
    url: "./data/connectors/enablebanking.sqlite3",
  },
});
