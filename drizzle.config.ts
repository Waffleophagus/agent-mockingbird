import { defineConfig } from "drizzle-kit";

const dbPath = process.env.WAFFLEBOT_DB_PATH ?? "./data/wafflebot.db";

export default defineConfig({
  schema: "./apps/server/src/backend/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath,
  },
  strict: true,
  verbose: true,
});
