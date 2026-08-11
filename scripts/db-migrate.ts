import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";

async function main() {
  await migrateDb(db());
  console.log(
    `Migrations applied to ${process.env.DATABASE_URL ? "Postgres (DATABASE_URL)" : "local PGlite (.data/pglite)"}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
