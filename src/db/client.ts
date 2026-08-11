/**
 * Database client with two interchangeable drivers:
 *
 *  - DATABASE_URL set   → node-postgres against real Postgres (Supabase etc.)
 *  - DATABASE_URL unset → PGlite (real Postgres compiled to WASM) persisted
 *                         to .data/pglite — zero-install local development.
 *
 * Both run the same schema and the same migrations. Server-side only — kept
 * importable from plain Node so CLI scripts (seed/migrate) can use it; the
 * `server-only` guard lives in the repository layer that pages import.
 */
import { mkdirSync } from "node:fs";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;

// Next.js dev server re-evaluates modules across requests; keep singletons on
// globalThis so we don't open a new PGlite instance (or pool) per request.
const g = globalThis as unknown as {
  __db?: Db;
  __dbReady?: Promise<void>;
};

function createDb(): Db {
  const url = process.env.DATABASE_URL;
  if (url) {
    const pool = new Pool({ connectionString: url, max: 5 });
    return drizzlePg(pool, { schema });
  }
  const dataDir = process.env.PGLITE_DIR ?? ".data/pglite";
  mkdirSync(dataDir, { recursive: true }); // PGlite won't create parent dirs
  const pglite = new PGlite(dataDir);
  return drizzlePglite(pglite, { schema });
}

export function db(): Db {
  if (!g.__db) g.__db = createDb();
  return g.__db;
}

/**
 * Ensure migrations (and demo seed, if enabled) have run. Called lazily by
 * the repository so `npm run dev` works with zero setup.
 */
export async function ensureDbReady(): Promise<void> {
  if (!g.__dbReady) {
    g.__dbReady = (async () => {
      const { migrateDb } = await import("./migrate");
      await migrateDb(db());
      const { seedDemoIfEmpty } = await import("./seed-demo");
      await seedDemoIfEmpty();
    })();
  }
  return g.__dbReady;
}

export { schema };
