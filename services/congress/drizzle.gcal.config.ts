import { defineConfig } from "drizzle-kit";

// The Google Calendar connector's cache DB (see src/connectors/googleCalendar/db).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/connectors/googleCalendar/db/schema.ts",
  out: "./src/connectors/googleCalendar/db/migrations",
  dbCredentials: {
    url: "./data/connectors/google-calendar.sqlite3",
  },
});
