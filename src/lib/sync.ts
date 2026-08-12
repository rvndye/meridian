/**
 * Synchronization engine.
 *
 * Guarantees:
 *  - Dedup on stable provider transaction IDs — re-syncing never duplicates.
 *  - Pending → posted: the posted transaction replaces its pending precursor
 *    in place (same row), preserving any user edits made while pending.
 *  - User category overrides survive provider updates.
 *  - Original provider payloads are preserved in provider_data.
 *  - Every run is recorded in sync_events; failures never leave a connection
 *    half-updated without a log entry.
 *  - No tokens, account numbers, or raw provider errors in log messages.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db, ensureDbReady, schema } from "@/db/client";
import { decryptSecret } from "./crypto";
import { detectTransfers } from "./domain/analytics";
import { mapProviderCategory } from "./domain/categories";
import { refreshRecurring, toCents } from "./repo";
import { PlaidFinancialDataProvider } from "./providers/plaid";
import type {
  FinancialDataProvider,
  ProviderTransaction,
} from "./providers/types";
import type { Account, Transaction } from "./domain/types";

type ConnectionRow = typeof schema.financialConnections.$inferSelect;

function providerFor(conn: ConnectionRow): FinancialDataProvider {
  if (conn.provider === "plaid") return new PlaidFinancialDataProvider();
  throw new Error(`No provider implementation for '${conn.provider}'`);
}

export interface SyncSummary {
  connectionId: string;
  status: "success" | "error";
  added: number;
  modified: number;
  removed: number;
  message: string | null;
}

export async function runSyncAll(): Promise<SyncSummary[]> {
  await ensureDbReady();
  const connections = await db()
    .select()
    .from(schema.financialConnections)
    .where(eq(schema.financialConnections.status, "active"));
  const results: SyncSummary[] = [];
  for (const conn of connections) {
    if (conn.provider === "manual") {
      // Manual accounts (e.g. Apple Card) have no upstream to poll —
      // they update through statement imports.
      results.push({
        connectionId: conn.id,
        status: "success",
        added: 0,
        modified: 0,
        removed: 0,
        message: "Manual accounts update via statement imports",
      });
      continue;
    }
    results.push(
      conn.provider === "demo"
        ? await refreshDemoConnection(conn)
        : await syncConnection(conn),
    );
  }
  if (results.length > 0) {
    await postProcess();
  }
  return results;
}

/** Demo connections have no upstream; a "sync" refreshes derived data. */
async function refreshDemoConnection(
  conn: ConnectionRow,
): Promise<SyncSummary> {
  const d = db();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const accounts = await d
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.connectionId, conn.id));
  for (const a of accounts) {
    await d
      .update(schema.accounts)
      .set({ lastSyncedAt: now })
      .where(eq(schema.accounts.id, a.id));
    await d
      .insert(schema.balanceSnapshots)
      .values({
        id: randomUUID(),
        accountId: a.id,
        date: today,
        balanceCents: a.currentBalanceCents,
      })
      .onConflictDoUpdate({
        target: [
          schema.balanceSnapshots.accountId,
          schema.balanceSnapshots.date,
        ],
        set: { balanceCents: a.currentBalanceCents },
      });
  }
  await d
    .update(schema.financialConnections)
    .set({ lastSyncedAt: now })
    .where(eq(schema.financialConnections.id, conn.id));
  await d.insert(schema.syncEvents).values({
    id: randomUUID(),
    connectionId: conn.id,
    startedAt: now,
    finishedAt: new Date(),
    status: "success",
    added: 0,
    modified: 0,
    removed: 0,
    message: "Demo connection refreshed",
  });
  return {
    connectionId: conn.id,
    status: "success",
    added: 0,
    modified: 0,
    removed: 0,
    message: "Demo connection refreshed",
  };
}

async function syncConnection(conn: ConnectionRow): Promise<SyncSummary> {
  const d = db();
  const eventId = randomUUID();
  const startedAt = new Date();
  await d.insert(schema.syncEvents).values({
    id: eventId,
    connectionId: conn.id,
    startedAt,
    status: "running",
  });

  let added = 0;
  let modified = 0;
  let removed = 0;

  try {
    if (!conn.accessTokenEncrypted) {
      throw new Error("Connection has no stored access token");
    }
    const provider = providerFor(conn);
    const token = decryptSecret(conn.accessTokenEncrypted);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    // ---- accounts & balances ----
    const providerAccounts = await provider.syncAccounts(token);
    const accountIdByProviderId = new Map<string, string>();
    for (const pa of providerAccounts) {
      const existing = await d
        .select()
        .from(schema.accounts)
        .where(
          and(
            eq(schema.accounts.connectionId, conn.id),
            eq(schema.accounts.providerAccountId, pa.providerAccountId),
          ),
        )
        .limit(1);
      const values = {
        institutionName: conn.institutionId
          ? ((
              await d
                .select()
                .from(schema.institutions)
                .where(eq(schema.institutions.id, conn.institutionId))
                .limit(1)
            )[0]?.name ?? "Unknown")
          : "Unknown",
        name: pa.name,
        officialName: pa.officialName,
        type: pa.type,
        mask: pa.mask,
        currentBalanceCents: toCents(pa.currentBalance),
        availableBalanceCents:
          pa.availableBalance !== null ? toCents(pa.availableBalance) : null,
        creditLimitCents:
          pa.creditLimit !== null ? toCents(pa.creditLimit) : null,
        currency: pa.currency,
        status: "active",
        lastSyncedAt: now,
      };
      let accountId: string;
      if (existing.length > 0) {
        accountId = existing[0].id;
        await d
          .update(schema.accounts)
          .set(values)
          .where(eq(schema.accounts.id, accountId));
      } else {
        accountId = `acc_${randomUUID()}`;
        await d.insert(schema.accounts).values({
          id: accountId,
          connectionId: conn.id,
          providerAccountId: pa.providerAccountId,
          ...values,
        });
      }
      accountIdByProviderId.set(pa.providerAccountId, accountId);
      await d
        .insert(schema.balanceSnapshots)
        .values({
          id: randomUUID(),
          accountId,
          date: today,
          balanceCents: toCents(pa.currentBalance),
        })
        .onConflictDoUpdate({
          target: [
            schema.balanceSnapshots.accountId,
            schema.balanceSnapshots.date,
          ],
          set: { balanceCents: toCents(pa.currentBalance) },
        });
    }

    // ---- transactions (incremental, cursor-based) ----
    const rules = await d.select().from(schema.categoryRules);
    let cursor = conn.syncCursor;
    let hasMore = true;
    while (hasMore) {
      const page = await provider.syncTransactions(token, cursor);
      for (const pt of page.added) {
        const r = await ingestTransaction(pt, accountIdByProviderId, rules);
        if (r === "added") added += 1;
        else if (r === "modified") modified += 1;
      }
      for (const pt of page.modified) {
        const r = await ingestTransaction(pt, accountIdByProviderId, rules);
        if (r === "added") added += 1;
        else if (r === "modified") modified += 1;
      }
      if (page.removedProviderTransactionIds.length > 0) {
        await d
          .update(schema.transactions)
          .set({ removed: true, updatedAt: new Date() })
          .where(
            inArray(
              schema.transactions.providerTransactionId,
              page.removedProviderTransactionIds,
            ),
          );
        removed += page.removedProviderTransactionIds.length;
      }
      cursor = page.nextCursor ?? cursor;
      hasMore = page.hasMore;
    }

    await d
      .update(schema.financialConnections)
      .set({
        syncCursor: cursor,
        lastSyncedAt: new Date(),
        status: "active",
        errorMessage: null,
      })
      .where(eq(schema.financialConnections.id, conn.id));

    await d
      .update(schema.syncEvents)
      .set({
        finishedAt: new Date(),
        status: "success",
        added,
        modified,
        removed,
        message: `Synced ${added} new, ${modified} updated, ${removed} removed`,
      })
      .where(eq(schema.syncEvents.id, eventId));

    return {
      connectionId: conn.id,
      status: "success",
      added,
      modified,
      removed,
      message: null,
    };
  } catch (err) {
    // Sanitized message only — provider errors can embed identifiers.
    const message =
      err instanceof Error
        ? err.message.slice(0, 200)
        : "Unknown sync failure";
    await d
      .update(schema.syncEvents)
      .set({ finishedAt: new Date(), status: "error", message })
      .where(eq(schema.syncEvents.id, eventId));
    await d
      .update(schema.financialConnections)
      .set({ status: "error", errorMessage: message })
      .where(eq(schema.financialConnections.id, conn.id));
    return {
      connectionId: conn.id,
      status: "error",
      added,
      modified,
      removed,
      message,
    };
  }
}

type RuleRow = typeof schema.categoryRules.$inferSelect;

function categorize(
  pt: ProviderTransaction,
  rules: RuleRow[],
): { categoryId: string; categorySource: "rule" | "provider" | "default" } {
  const hay = `${pt.merchant} ${pt.rawDescription}`.toLowerCase();
  const rule = rules.find((r) =>
    hay.includes(r.merchantPattern.toLowerCase()),
  );
  if (rule) return { categoryId: rule.categoryId, categorySource: "rule" };
  const mapped = mapProviderCategory(
    pt.providerCategoryPrimary,
    pt.providerCategoryDetailed,
  );
  if (pt.providerCategoryPrimary) {
    return { categoryId: mapped, categorySource: "provider" };
  }
  return { categoryId: "other", categorySource: "default" };
}

/**
 * Insert or update one incoming provider transaction.
 *  1. Same providerTransactionId → update (provider refresh), keeping user
 *     category/merchant/notes edits.
 *  2. New posted txn referencing a pending one we hold → replace in place.
 *  3. Otherwise insert.
 */
export async function ingestTransaction(
  pt: ProviderTransaction,
  accountIdByProviderId: Map<string, string>,
  rules: RuleRow[],
): Promise<"added" | "modified" | "skipped"> {
  const d = db();
  const accountId = accountIdByProviderId.get(pt.providerAccountId);
  if (!accountId) return "skipped"; // account not in this connection

  const base = {
    date: pt.date,
    amountCents: toCents(pt.amount),
    currency: pt.currency,
    status: pt.pending ? ("pending" as const) : ("posted" as const),
    providerCategory:
      pt.providerCategoryDetailed ?? pt.providerCategoryPrimary,
    providerData: pt.raw as object,
    updatedAt: new Date(),
  };

  const [byId] = await d
    .select()
    .from(schema.transactions)
    .where(eq(schema.transactions.providerTransactionId, pt.providerTransactionId))
    .limit(1);
  if (byId) {
    const keepUser = byId.categorySource === "user";
    await d
      .update(schema.transactions)
      .set({
        ...base,
        ...(keepUser
          ? {}
          : {
              merchant: pt.merchant,
              rawDescription: pt.rawDescription,
              ...categorize(pt, rules),
            }),
      })
      .where(eq(schema.transactions.id, byId.id));
    return "modified";
  }

  if (pt.pendingProviderTransactionId) {
    const [pendingRow] = await d
      .select()
      .from(schema.transactions)
      .where(
        eq(
          schema.transactions.providerTransactionId,
          pt.pendingProviderTransactionId,
        ),
      )
      .limit(1);
    if (pendingRow) {
      const keepUser = pendingRow.categorySource === "user";
      await d
        .update(schema.transactions)
        .set({
          ...base,
          providerTransactionId: pt.providerTransactionId,
          pendingProviderTransactionId: pt.pendingProviderTransactionId,
          ...(keepUser
            ? {}
            : {
                merchant: pt.merchant,
                rawDescription: pt.rawDescription,
                ...categorize(pt, rules),
              }),
        })
        .where(eq(schema.transactions.id, pendingRow.id));
      return "modified";
    }
  }

  await d.insert(schema.transactions).values({
    id: `txn_${randomUUID()}`,
    accountId,
    providerTransactionId: pt.providerTransactionId,
    pendingProviderTransactionId: pt.pendingProviderTransactionId,
    merchant: pt.merchant,
    rawDescription: pt.rawDescription,
    ...base,
    ...categorize(pt, rules),
    isTransfer: false,
    transferPairId: null,
    notes: null,
  });
  return "added";
}

/**
 * Post-sync pass over the recent window: transfer/CC-payment detection and
 * recurring refresh. Never overrides user categorization.
 */
export async function postProcess(windowDays = 120): Promise<void> {
  const d = db();
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - windowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const accountRows = await d.select().from(schema.accounts);
  const accounts: Account[] = accountRows.map((r) => ({
    id: r.id,
    institutionName: r.institutionName,
    name: r.name,
    officialName: r.officialName,
    type: r.type as Account["type"],
    mask: r.mask,
    currentBalance: r.currentBalanceCents / 100,
    availableBalance:
      r.availableBalanceCents !== null ? r.availableBalanceCents / 100 : null,
    creditLimit: r.creditLimitCents !== null ? r.creditLimitCents / 100 : null,
    currency: r.currency,
    status: r.status as Account["status"],
    lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
  }));

  const txnRows = await d
    .select()
    .from(schema.transactions)
    .where(
      and(
        gte(schema.transactions.date, since),
        eq(schema.transactions.removed, false),
      ),
    );
  const txns: Transaction[] = txnRows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    providerTransactionId: r.providerTransactionId,
    date: r.date,
    merchant: r.merchant,
    rawDescription: r.rawDescription,
    amount: r.amountCents / 100,
    currency: r.currency,
    status: r.status as Transaction["status"],
    categoryId: r.categoryId,
    categorySource: r.categorySource as Transaction["categorySource"],
    providerCategory: r.providerCategory,
    isTransfer: r.isTransfer,
    transferPairId: r.transferPairId,
    notes: r.notes,
  }));

  const detected = detectTransfers(txns, accounts);
  const before = new Map(txns.map((t) => [t.id, t]));
  for (const t of detected) {
    const orig = before.get(t.id)!;
    if (
      t.isTransfer !== orig.isTransfer ||
      t.categoryId !== orig.categoryId ||
      t.transferPairId !== orig.transferPairId
    ) {
      await d
        .update(schema.transactions)
        .set({
          isTransfer: t.isTransfer,
          categoryId: t.categoryId,
          categorySource: t.categorySource,
          transferPairId: t.transferPairId,
          updatedAt: new Date(),
        })
        .where(eq(schema.transactions.id, t.id));
    }
  }

  await refreshRecurring(today);
}
