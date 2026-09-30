import { defineConfig } from "drizzle-kit";

// The Gmail connector's cache DB (see src/connectors/gmail/db).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/connectors/gmail/db/schema.ts",
  out: "./src/connectors/gmail/db/migrations",
  dbCredentials: {
    url: "./data/connectors/gmail.sqlite3",
  },
});
