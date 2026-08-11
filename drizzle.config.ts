import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Only used by `drizzle-kit migrate/push` against a real database.
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/postgres",
  },
});
