import { defineConfig } from "drizzle-kit";

// The WhatsApp connector's cache DB (see src/connectors/whatsapp/db).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/connectors/whatsapp/db/schema.ts",
  out: "./src/connectors/whatsapp/db/migrations",
  dbCredentials: {
    url: "./data/connectors/whatsapp.sqlite3",
  },
});
