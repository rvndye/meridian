/**
 * Danger: wipes all data (drops known tables), re-runs migrations, and —
 * unless DEMO_DATA=false — reseeds demo data. For local development.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { seedDemo } from "../src/db/seed-demo";

async function main() {
  // Refuse to drop a remote (e.g. production Supabase) database unless
  // explicitly forced. Local PGlite and localhost Postgres are fine.
  const url = process.env.DATABASE_URL;
  const isRemote =
    url && !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  if (isRemote && process.env.FORCE_DB_RESET !== "yes") {
    console.error(
      "Refusing to reset a remote database. If you REALLY mean it, re-run with FORCE_DB_RESET=yes.",
    );
    process.exit(1);
  }
  const d = db();
  await d.execute(sql`
    drop table if exists
      transactions, balance_snapshots, recurring_transactions, category_rules,
      accounts, financial_connections, institutions, sync_events,
      user_settings, users, __drizzle_migrations cascade
  `);
  await d.execute(sql`drop schema if exists drizzle cascade`);
  await migrateDb(d);
  if (process.env.DEMO_DATA !== "false") {
    await seedDemo();
    console.log("Database reset and demo data seeded.");
  } else {
    console.log("Database reset (empty).");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Reset failed:", err.message);
  process.exit(1);
});
