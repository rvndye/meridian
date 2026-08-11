/**
 * Danger: wipes all data (drops known tables), re-runs migrations, and —
 * unless DEMO_DATA=false — reseeds demo data. For local development.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { seedDemo } from "../src/db/seed-demo";

async function main() {
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
