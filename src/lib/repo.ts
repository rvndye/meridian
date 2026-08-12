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
  Asset,
  AssetValuation,
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

// ---------- assets & valuations ----------

type AssetRow = typeof schema.assets.$inferSelect;
type ValuationRow = typeof schema.assetValuations.$inferSelect;

function assetFromRow(r: AssetRow): Asset {
  return {
    id: r.id,
    name: r.name,
    assetType: r.assetType as Asset["assetType"],
    description: r.description,
    address: r.address,
    purchaseDate: r.purchaseDate,
    purchasePrice:
      r.purchasePriceCents !== null ? toDollars(r.purchasePriceCents) : null,
    currentValue: toDollars(r.currentValueCents),
    valuationMethod: r.valuationMethod as Asset["valuationMethod"],
    currency: r.currency,
    details: (r.details as Asset["details"]) ?? null,
    liabilityAccountId: r.liabilityAccountId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function valuationFromRow(r: ValuationRow): AssetValuation {
  return {
    id: r.id,
    assetId: r.assetId,
    valuationDate: r.valuationDate,
    value: toDollars(r.valueCents),
    valueLow: r.valueLowCents !== null ? toDollars(r.valueLowCents) : null,
    valueHigh: r.valueHighCents !== null ? toDollars(r.valueHighCents) : null,
    source: r.source as AssetValuation["source"],
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function getAssets(): Promise<Asset[]> {
  await ensureDbReady();
  const rows = await db().select().from(schema.assets).orderBy(schema.assets.name);
  return rows.map(assetFromRow);
}

export async function getAsset(id: string): Promise<Asset | null> {
  await ensureDbReady();
  const [row] = await db()
    .select()
    .from(schema.assets)
    .where(eq(schema.assets.id, id))
    .limit(1);
  return row ? assetFromRow(row) : null;
}

/** All valuations, oldest first (optionally for one asset). */
export async function getAssetValuations(
  assetId?: string,
): Promise<AssetValuation[]> {
  await ensureDbReady();
  const q = db().select().from(schema.assetValuations);
  const rows = assetId
    ? await q.where(eq(schema.assetValuations.assetId, assetId))
    : await q;
  return rows
    .map(valuationFromRow)
    .sort(
      (a, b) =>
        a.valuationDate.localeCompare(b.valuationDate) ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

export interface AssetInput {
  name: string;
  assetType: Asset["assetType"];
  description?: string | null;
  address?: string | null;
  purchaseDate?: string | null;
  purchasePrice?: number | null;
  valuationMethod: Asset["valuationMethod"];
  details?: Asset["details"];
  liabilityAccountId?: string | null;
  /** Initial value — recorded as the first (manual) valuation. */
  currentValue: number;
  valuationDate?: string;
}

export async function createAsset(input: AssetInput): Promise<Asset> {
  await ensureDbReady();
  const d = db();
  const id = `asset_${randomUUID()}`;
  const now = new Date();
  await d.insert(schema.assets).values({
    id,
    name: input.name,
    assetType: input.assetType,
    description: input.description ?? null,
    address: input.address ?? null,
    purchaseDate: input.purchaseDate ?? null,
    purchasePriceCents:
      input.purchasePrice != null ? toCents(input.purchasePrice) : null,
    currentValueCents: toCents(input.currentValue),
    valuationMethod: input.valuationMethod,
    details: input.details ?? null,
    liabilityAccountId: input.liabilityAccountId ?? null,
    createdAt: now,
    updatedAt: now,
  });
  await d.insert(schema.assetValuations).values({
    id: `val_${randomUUID()}`,
    assetId: id,
    valuationDate:
      input.valuationDate ?? now.toISOString().slice(0, 10),
    valueCents: toCents(input.currentValue),
    source: "manual",
    notes: "Initial value",
  });
  return (await getAsset(id))!;
}

export interface AssetPatch {
  name?: string;
  description?: string | null;
  address?: string | null;
  purchaseDate?: string | null;
  purchasePrice?: number | null;
  valuationMethod?: Asset["valuationMethod"];
  details?: Asset["details"];
  liabilityAccountId?: string | null;
}

export async function updateAsset(
  id: string,
  patch: AssetPatch,
): Promise<Asset | null> {
  await ensureDbReady();
  const d = db();
  const existing = await getAsset(id);
  if (!existing) return null;
  await d
    .update(schema.assets)
    .set({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.address !== undefined && { address: patch.address }),
      ...(patch.purchaseDate !== undefined && { purchaseDate: patch.purchaseDate }),
      ...(patch.purchasePrice !== undefined && {
        purchasePriceCents:
          patch.purchasePrice != null ? toCents(patch.purchasePrice) : null,
      }),
      ...(patch.valuationMethod !== undefined && {
        valuationMethod: patch.valuationMethod,
      }),
      ...(patch.details !== undefined && { details: patch.details }),
      ...(patch.liabilityAccountId !== undefined && {
        liabilityAccountId: patch.liabilityAccountId,
      }),
      updatedAt: new Date(),
    })
    .where(eq(schema.assets.id, id));
  // valuationMethod changes can change the effective value
  await recomputeAssetValue(id);
  return getAsset(id);
}

export async function deleteAsset(id: string): Promise<boolean> {
  await ensureDbReady();
  const d = db();
  const existing = await getAsset(id);
  if (!existing) return false;
  await d
    .delete(schema.assetValuations)
    .where(eq(schema.assetValuations.assetId, id));
  await d.delete(schema.assets).where(eq(schema.assets.id, id));
  return true;
}

export interface ValuationInput {
  valuationDate: string;
  value: number;
  source: AssetValuation["source"];
  valueLow?: number | null;
  valueHigh?: number | null;
  notes?: string | null;
}

/**
 * Append a valuation to the history (never overwrites previous records) and
 * refresh the asset's denormalized effective value.
 */
export async function addAssetValuation(
  assetId: string,
  input: ValuationInput,
): Promise<AssetValuation | null> {
  await ensureDbReady();
  const d = db();
  const asset = await getAsset(assetId);
  if (!asset) return null;
  const id = `val_${randomUUID()}`;
  await d.insert(schema.assetValuations).values({
    id,
    assetId,
    valuationDate: input.valuationDate,
    valueCents: toCents(input.value),
    valueLowCents: input.valueLow != null ? toCents(input.valueLow) : null,
    valueHighCents: input.valueHigh != null ? toCents(input.valueHigh) : null,
    source: input.source,
    notes: input.notes ?? null,
  });
  await recomputeAssetValue(assetId);
  const rows = await getAssetValuations(assetId);
  return rows.find((v) => v.id === id) ?? null;
}

/** Re-derive the denormalized current value from the valuation history. */
async function recomputeAssetValue(assetId: string): Promise<void> {
  const d = db();
  const asset = await getAsset(assetId);
  if (!asset) return;
  const valuations = await getAssetValuations(assetId);
  const { effectiveAssetValue } = await import("./domain/assets");
  const effective = effectiveAssetValue(asset, valuations);
  await d
    .update(schema.assets)
    .set({ currentValueCents: toCents(effective.value), updatedAt: new Date() })
    .where(eq(schema.assets.id, assetId));
}

// ---------- statement imports ----------

export async function findStatementImport(
  accountId: string,
  fileHash: string,
) {
  await ensureDbReady();
  const [row] = await db()
    .select()
    .from(schema.statementImports)
    .where(
      and(
        eq(schema.statementImports.accountId, accountId),
        eq(schema.statementImports.fileHash, fileHash),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function recordStatementImport(input: {
  accountId: string;
  source: string;
  fileHash: string;
  periodStart: string | null;
  periodEnd: string | null;
  importedCount: number;
  duplicateCount: number;
  uncertainCount: number;
}): Promise<void> {
  await ensureDbReady();
  await db()
    .insert(schema.statementImports)
    .values({ id: `imp_${randomUUID()}`, ...input })
    .onConflictDoUpdate({
      target: [
        schema.statementImports.accountId,
        schema.statementImports.fileHash,
      ],
      set: {
        importedCount: input.importedCount,
        duplicateCount: input.duplicateCount,
        uncertainCount: input.uncertainCount,
      },
    });
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
