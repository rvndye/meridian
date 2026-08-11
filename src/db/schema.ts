/**
 * Database schema (PostgreSQL, via Drizzle).
 *
 * Conventions:
 *  - Money is stored as integer cents (exact); the repository layer converts
 *    to/from the domain's dollar numbers.
 *  - Provider payloads are preserved verbatim in provider_data (jsonb) —
 *    original provider metadata is never destroyed.
 *  - Amount sign follows the domain convention: >0 outflow, <0 inflow.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const institutions = pgTable("institutions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  providerInstitutionId: text("provider_institution_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A live link to a data provider (e.g. one Plaid Item). The access token is
 * stored encrypted (AES-256-GCM) — never in plaintext, never logged.
 */
export const financialConnections = pgTable(
  "financial_connections",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(), // 'plaid' | 'demo'
    providerItemId: text("provider_item_id"),
    institutionId: text("institution_id").references(() => institutions.id),
    accessTokenEncrypted: text("access_token_encrypted"),
    /** Provider incremental-sync cursor (Plaid transactions/sync). */
    syncCursor: text("sync_cursor"),
    status: text("status").notNull().default("active"), // active | error | disconnected
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("fc_provider_item_idx").on(t.provider, t.providerItemId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").references(
      () => financialConnections.id,
    ),
    providerAccountId: text("provider_account_id"),
    institutionName: text("institution_name").notNull(),
    name: text("name").notNull(),
    officialName: text("official_name"),
    type: text("type").notNull(), // checking|savings|credit_card|investment|retirement|loan|other
    mask: text("mask"),
    currentBalanceCents: integer("current_balance_cents").notNull().default(0),
    availableBalanceCents: integer("available_balance_cents"),
    creditLimitCents: integer("credit_limit_cents"),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("active"),
    hidden: boolean("hidden").notNull().default(false),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("acct_provider_idx").on(t.connectionId, t.providerAccountId),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    /** Stable provider ID — the dedup key across syncs. */
    providerTransactionId: text("provider_transaction_id"),
    /** Provider's ID for the pending precursor of this posted transaction. */
    pendingProviderTransactionId: text("pending_provider_transaction_id"),
    date: text("date").notNull(), // YYYY-MM-DD
    merchant: text("merchant").notNull(),
    rawDescription: text("raw_description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("posted"), // pending | posted
    categoryId: text("category_id").notNull().default("other"),
    categorySource: text("category_source").notNull().default("default"),
    providerCategory: text("provider_category"),
    /** Full original provider payload; never destroyed. */
    providerData: jsonb("provider_data"),
    isTransfer: boolean("is_transfer").notNull().default(false),
    transferPairId: text("transfer_pair_id"),
    notes: text("notes"),
    /** Set when the provider removes a transaction (kept for audit). */
    removed: boolean("removed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("txn_provider_idx").on(t.providerTransactionId),
    index("txn_date_idx").on(t.date),
    index("txn_account_date_idx").on(t.accountId, t.date),
    index("txn_category_idx").on(t.categoryId),
    index("txn_merchant_idx").on(t.merchant),
  ],
);

/** merchant_pattern → category, created from user recategorizations. */
export const categoryRules = pgTable(
  "category_rules",
  {
    id: text("id").primaryKey(),
    /** Case-insensitive substring match against merchant + raw description. */
    merchantPattern: text("merchant_pattern").notNull(),
    categoryId: text("category_id").notNull(),
    priority: integer("priority").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("rule_pattern_idx").on(t.merchantPattern)],
);

/** Detected recurring streams, refreshed after each sync. */
export const recurringTransactions = pgTable("recurring_transactions", {
  id: text("id").primaryKey(),
  merchant: text("merchant").notNull(),
  categoryId: text("category_id").notNull(),
  accountId: text("account_id").notNull(),
  cadence: text("cadence").notNull(),
  typicalAmountCents: integer("typical_amount_cents").notNull(),
  lastDate: text("last_date").notNull(),
  nextExpectedDate: text("next_expected_date").notNull(),
  annualizedCostCents: integer("annualized_cost_cents").notNull(),
  occurrences: integer("occurrences").notNull(),
  active: boolean("active").notNull().default(true),
  /** User can hide false positives. */
  muted: boolean("muted").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Daily/point-in-time balances powering net-worth history. */
export const balanceSnapshots = pgTable(
  "balance_snapshots",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    date: text("date").notNull(),
    balanceCents: integer("balance_cents").notNull(),
  },
  (t) => [
    uniqueIndex("snap_account_date_idx").on(t.accountId, t.date),
    index("snap_date_idx").on(t.date),
  ],
);

export const syncEvents = pgTable(
  "sync_events",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull(), // running | success | error
    added: integer("added").notNull().default(0),
    modified: integer("modified").notNull().default(0),
    removed: integer("removed").notNull().default(0),
    /** Human-readable summary only — never tokens or account numbers. */
    message: text("message"),
  },
  (t) => [index("sync_started_idx").on(t.startedAt)],
);

export const userSettings = pgTable("user_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
