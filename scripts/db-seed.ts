import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { seedDemo } from "../src/db/seed-demo";
import { schema } from "../src/db/client";

async function main() {
  const d = db();
  await migrateDb(d);
  const existing = await d.select().from(schema.accounts).limit(1);
  if (existing.length > 0) {
    console.log("Database already has accounts; skipping. Use db:reset first to reseed.");
    process.exit(0);
  }
  await seedDemo();
  console.log("Demo data seeded.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
