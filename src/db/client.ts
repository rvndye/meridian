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

/** True on Vercel or any NODE_ENV=production server. */
export function isProductionRuntime(): boolean {
  return !!process.env.VERCEL || process.env.NODE_ENV === "production";
}

function createDb(): Db {
  const url = process.env.DATABASE_URL;
  if (url) {
    // Serverless: one connection per function instance — Supabase's pooler
    // (or the platform) provides the real concurrency. Local dev keeps a
    // small pool for snappier parallel queries.
    const pool = new Pool({
      connectionString: url,
      max: process.env.VERCEL ? 1 : 5,
    });
    return drizzlePg(pool, { schema });
  }
  // PGlite is a LOCAL-DEV convenience only: on a serverless platform its
  // file store is ephemeral and per-instance — silently "working" there
  // would mean silent data loss. Fail loudly instead.
  if (isProductionRuntime()) {
    throw new Error(
      "DATABASE_URL is not set. Production refuses to fall back to the embedded local database — configure a Postgres connection string (e.g. Supabase).",
    );
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
 * Ensure the database is ready.
 *
 * Local dev: lazily applies migrations and (unless DEMO_DATA=false) seeds
 * the demo dataset, so `npm run dev` works with zero setup.
 *
 * Production (Vercel / NODE_ENV=production): does neither. Migrations are
 * applied once at deploy time (`npm run db:migrate` with the production
 * DATABASE_URL) — running them lazily from concurrently-booting serverless
 * instances would race, and demo data must never appear in production.
 */
export async function ensureDbReady(): Promise<void> {
  if (!g.__dbReady) {
    g.__dbReady = (async () => {
      if (isProductionRuntime()) {
        db(); // constructs the client; throws if DATABASE_URL is missing
        return;
      }
      const { migrateDb } = await import("./migrate");
      await migrateDb(db());
      const { seedDemoIfEmpty } = await import("./seed-demo");
      await seedDemoIfEmpty();
    })();
  }
  return g.__dbReady;
}

export { schema };
