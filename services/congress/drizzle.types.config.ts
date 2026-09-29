import { defineConfig } from "drizzle-kit";

// The type engine's meta tables in exhibits.sqlite3 (see src/typeEngine/db).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/typeEngine/db/schema.ts",
  out: "./src/typeEngine/db/migrations",
  dbCredentials: {
    url: process.env.EXHIBITS_DB_PATH ?? "./data/exhibits.sqlite3",
  },
});
