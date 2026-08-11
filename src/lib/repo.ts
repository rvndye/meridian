/**
 * Repository: the only module that touches the database. Converts rows
 * (integer cents) to domain types (dollar numbers) and back. All queries are
 * parameterized via Drizzle.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, ensureDbReady, schema } from "@/db/client";
import type {
  Account,
  BalanceSnapshot,
  CategoryRule,
  RecurringItem,
  SyncEvent,
  Transaction,
} from "./domain/types";
import { detectRecurring } from "./domain/analytics";
import { CATEGORY_BY_ID } from "./domain/categories";

const toDollars = (c: number) => c / 100;
const toCents = (n: number) => Math.round(n * 100);

// ---------- accounts ----------

type AccountRow = typeof schema.accounts.$inferSelect;

function accountFromRow(r: AccountRow): Account {
  return {
    id: r.id,
    institutionName: r.institutionName,
    name: r.name,
    officialName: r.officialName,
    type: r.type as Account["type"],
    mask: r.mask,
    currentBalance: toDollars(r.currentBalanceCents),
    availableBalance:
      r.availableBalanceCents !== null
        ? toDollars(r.availableBalanceCents)
        : null,
    creditLimit:
      r.creditLimitCents !== null ? toDollars(r.creditLimitCents) : null,
    currency: r.currency,
    status: r.status as Account["status"],
    lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
  };
}

export async function getAccounts(): Promise<Account[]> {
  await ensureDbReady();
  const rows = await db()
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.hidden, false))
    .orderBy(schema.accounts.institutionName, schema.accounts.name);
  return rows.map(accountFromRow);
}

// ---------- transactions ----------

type TxnRow = typeof schema.transactions.$inferSelect;

function txnFromRow(r: TxnRow): Transaction {
  return {
    id: r.id,
    accountId: r.accountId,
    providerTransactionId: r.providerTransactionId,
    date: r.date,
    merchant: r.merchant,
    rawDescription: r.rawDescription,
    amount: toDollars(r.amountCents),
    currency: r.currency,
    status: r.status as Transaction["status"],
    categoryId: r.categoryId,
    categorySource: r.categorySource as Transaction["categorySource"],
    providerCategory: r.providerCategory,
    isTransfer: r.isTransfer,
    transferPairId: r.transferPairId,
    notes: r.notes,
  };
}

export async function getTransactions(): Promise<Transaction[]> {
  await ensureDbReady();
  const rows = await db()
    .select()
    .from(schema.transactions)
    .where(eq(schema.transactions.removed, false))
    .orderBy(desc(schema.transactions.date));
  return rows.map(txnFromRow);
}

export interface TransactionUpdate {
  merchant?: string;
  categoryId?: string;
  notes?: string | null;
}

/**
 * Apply a user edit. A category change becomes a `user` override and (when
 * `createRule` is set) a merchant rule that recategorizes matching
 * transactions that don't already carry a user override.
 */
export async function updateTransaction(
  id: string,
  patch: TransactionUpdate,
  opts: { createRule?: boolean } = {},
): Promise<{ transaction: Transaction; ruleApplied: number } | null> {
  await ensureDbReady();
  const d = db();
  const [existing] = await d
    .select()
    .from(schema.transactions)
    .where(eq(schema.transactions.id, id))
    .limit(1);
  if (!existing) return null;

  const categoryChanged =
    patch.categoryId !== undefined && patch.categoryId !== existing.categoryId;

  await d
    .update(schema.transactions)
    .set({
      ...(patch.merchant !== undefined && { merchant: patch.merchant }),
      ...(patch.categoryId !== undefined && {
        categoryId: patch.categoryId,
        categorySource: "user" as const,
        // a user recategorization also overrides transfer auto-detection
        isTransfer:
          CATEGORY_BY_ID.get(patch.categoryId)?.kind === "transfer",
      }),
      ...(patch.notes !== undefined && { notes: patch.notes }),
      updatedAt: new Date(),
    })
    .where(eq(schema.transactions.id, id));
  const [updated] = await d
    .select()
    .from(schema.transactions)
    .where(eq(schema.transactions.id, id))
    .limit(1);

  let ruleApplied = 0;
  if (categoryChanged && patch.categoryId && opts.createRule !== false) {
    const pattern = (patch.merchant ?? existing.merchant).trim();
    if (pattern.length >= 2) {
      ruleApplied = await upsertRuleAndApply(pattern, patch.categoryId);
    }
  }

  return { transaction: txnFromRow(updated), ruleApplied };
}

// ---------- category rules ----------

type RuleRow = typeof schema.categoryRules.$inferSelect;

function ruleFromRow(r: RuleRow): CategoryRule {
  return {
    id: r.id,
    merchantPattern: r.merchantPattern,
    categoryId: r.categoryId,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function getCategoryRules(): Promise<CategoryRule[]> {
  await ensureDbReady();
  const rows = await db()
    .select()
    .from(schema.categoryRules)
    .orderBy(desc(schema.categoryRules.createdAt));
  return rows.map(ruleFromRow);
}

/**
 * Create/replace a merchant rule and retroactively apply it to matching
 * transactions whose category was NOT set explicitly by the user.
 * Returns the number of transactions recategorized.
 */
export async function upsertRuleAndApply(
  merchantPattern: string,
  categoryId: string,
): Promise<number> {
  await ensureDbReady();
  const d = db();
  await d
    .insert(schema.categoryRules)
    .values({ id: `rule_${randomUUID()}`, merchantPattern, categoryId })
    .onConflictDoUpdate({
      target: schema.categoryRules.merchantPattern,
      set: { categoryId },
    });

  const pattern = `%${merchantPattern.toLowerCase()}%`;
  const cond = and(
    sql`(lower(${schema.transactions.merchant}) like ${pattern} or lower(${schema.transactions.rawDescription}) like ${pattern})`,
    sql`${schema.transactions.categorySource} != 'user'`,
    eq(schema.transactions.isTransfer, false),
    eq(schema.transactions.removed, false),
  );
  const matches = await d
    .select({ id: schema.transactions.id })
    .from(schema.transactions)
    .where(cond);
  if (matches.length > 0) {
    await d
      .update(schema.transactions)
      .set({ categoryId, categorySource: "rule", updatedAt: new Date() })
      .where(cond);
  }
  return matches.length;
}

export async function deleteCategoryRule(id: string): Promise<void> {
  await ensureDbReady();
  await db().delete(schema.categoryRules).where(eq(schema.categoryRules.id, id));
}

// ---------- snapshots / net worth ----------

export async function getSnapshots(): Promise<BalanceSnapshot[]> {
  await ensureDbReady();
  const rows = await db()
    .select()
    .from(schema.balanceSnapshots)
    .orderBy(schema.balanceSnapshots.date);
  return rows.map((r) => ({
    accountId: r.accountId,
    date: r.date,
    balance: toDollars(r.balanceCents),
  }));
}

// ---------- recurring ----------

export async function getRecurring(): Promise<RecurringItem[]> {
  await ensureDbReady();
  const rows = await db()
    .select()
    .from(schema.recurringTransactions)
    .where(eq(schema.recurringTransactions.muted, false));
  return rows
    .map((r) => ({
      id: r.id,
      merchant: r.merchant,
      categoryId: r.categoryId,
      accountId: r.accountId,
      cadence: r.cadence as RecurringItem["cadence"],
      typicalAmount: toDollars(r.typicalAmountCents),
      lastDate: r.lastDate,
      nextExpectedDate: r.nextExpectedDate,
      annualizedCost: toDollars(r.annualizedCostCents),
      occurrences: r.occurrences,
      active: r.active,
    }))
    .sort((a, b) => Math.abs(b.annualizedCost) - Math.abs(a.annualizedCost));
}

/** Re-detect recurring streams from current transactions (post-sync). */
export async function refreshRecurring(today: string): Promise<void> {
  await ensureDbReady();
  const txns = await getTransactions();
  const items = detectRecurring(txns, today);
  const d = db();
  const muted = await d
    .select({ id: schema.recurringTransactions.id })
    .from(schema.recurringTransactions)
    .where(eq(schema.recurringTransactions.muted, true));
  const mutedIds = new Set(muted.map((m) => m.id));
  await d
    .delete(schema.recurringTransactions)
    .where(eq(schema.recurringTransactions.muted, false));
  const fresh = items.filter((r) => !mutedIds.has(r.id));
  if (fresh.length > 0) {
    await d.insert(schema.recurringTransactions).values(
      fresh.map((r) => ({
        id: r.id,
        merchant: r.merchant,
        categoryId: r.categoryId,
        accountId: r.accountId,
        cadence: r.cadence,
        typicalAmountCents: toCents(r.typicalAmount),
        lastDate: r.lastDate,
        nextExpectedDate: r.nextExpectedDate,
        annualizedCostCents: toCents(r.annualizedCost),
        occurrences: r.occurrences,
        active: r.active,
        updatedAt: new Date(),
      })),
    );
  }
}

// ---------- sync events ----------

export async function getSyncEvents(limit = 20): Promise<SyncEvent[]> {
  await ensureDbReady();
  const rows = await db()
    .select()
    .from(schema.syncEvents)
    .orderBy(desc(schema.syncEvents.startedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    connectionId: r.connectionId,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    status: r.status as SyncEvent["status"],
    added: r.added,
    modified: r.modified,
    removed: r.removed,
    message: r.message,
  }));
}

export async function getLastSyncedAt(): Promise<string | null> {
  await ensureDbReady();
  const rows = await db()
    .select({ lastSyncedAt: schema.accounts.lastSyncedAt })
    .from(schema.accounts);
  const times = rows
    .map((r) => r.lastSyncedAt?.toISOString())
    .filter((t): t is string => !!t)
    .sort();
  return times.at(-1) ?? null;
}

// ---------- connections ----------

export async function getConnections() {
  await ensureDbReady();
  return db().select().from(schema.financialConnections);
}

export { toCents, toDollars };
