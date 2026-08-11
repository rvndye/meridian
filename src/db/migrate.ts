import path from "node:path";
import type { Db } from "./client";

const migrationsFolder = path.join(process.cwd(), "drizzle");

/** Apply pending migrations using the migrator that matches the driver. */
export async function migrateDb(database: Db): Promise<void> {
  if (process.env.DATABASE_URL) {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(
      database as unknown as import("drizzle-orm/node-postgres").NodePgDatabase,
      { migrationsFolder },
    );
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(
      database as unknown as import("drizzle-orm/pglite").PgliteDatabase,
      { migrationsFolder },
    );
  }
}
