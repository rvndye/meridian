/**
 * Core domain types. Everything downstream — mock data, the database layer,
 * analytics, tests, and AI tools — speaks these types.
 *
 * Sign convention (matches Plaid): amount > 0 is money OUT (a debit/expense),
 * amount < 0 is money IN (a credit/income). Analytics never flips this.
 */

export type AccountType =
  | "checking"
  | "savings"
  | "credit_card"
  | "investment"
  | "retirement"
  | "loan"
  | "other";

export type AccountStatus = "active" | "error" | "disconnected";

export interface Account {
  id: string;
  institutionName: string;
  name: string;
  officialName: string | null;
  type: AccountType;
  /** Last 4 digits, for display only. Never a full account number. */
  mask: string | null;
  /**
   * Asset accounts: balance held (positive). Liability accounts (credit_card,
   * loan): amount owed, stored positive.
   */
  currentBalance: number;
  availableBalance: number | null;
  creditLimit: number | null;
  currency: string;
  status: AccountStatus;
  lastSyncedAt: string | null; // ISO datetime
}

export const LIABILITY_TYPES: ReadonlySet<AccountType> = new Set([
  "credit_card",
  "loan",
]);

export function isLiability(a: Pick<Account, "type">): boolean {
  return LIABILITY_TYPES.has(a.type);
}

export type CategoryKind = "expense" | "income" | "transfer";

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
}

export type TransactionStatus = "pending" | "posted";

export type CategorySource = "default" | "provider" | "rule" | "user";

export interface Transaction {
  id: string;
  accountId: string;
  /** Stable ID from the data provider; dedup key across syncs. */
  providerTransactionId: string | null;
  date: string; // YYYY-MM-DD
  /** Display merchant. User-editable; rawDescription preserves the original. */
  merchant: string;
  rawDescription: string;
  amount: number; // >0 outflow, <0 inflow
  currency: string;
  status: TransactionStatus;
  /** Effective normalized category after rules/overrides. */
  categoryId: string;
  categorySource: CategorySource;
  /** Original provider category string; never destroyed. */
  providerCategory: string | null;
  /** True for transfers between own accounts and credit-card payments. */
  isTransfer: boolean;
  /** ID of the matching opposite-side transaction, when identified. */
  transferPairId: string | null;
  notes: string | null;
}

export interface BalanceSnapshot {
  accountId: string;
  date: string; // YYYY-MM-DD
  /** Same convention as Account.currentBalance (liabilities positive-owed). */
  balance: number;
}

export type RecurringCadence =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "yearly";

export interface RecurringItem {
  id: string;
  merchant: string;
  categoryId: string;
  accountId: string;
  cadence: RecurringCadence;
  typicalAmount: number; // positive = an expense; negative = recurring income
  lastDate: string;
  nextExpectedDate: string;
  annualizedCost: number;
  occurrences: number;
  active: boolean;
}

export interface CategoryRule {
  id: string;
  /** Case-insensitive substring matched against merchant/rawDescription. */
  merchantPattern: string;
  categoryId: string;
  createdAt: string;
}

export interface SyncEvent {
  id: string;
  connectionId: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "error";
  added: number;
  modified: number;
  removed: number;
  message: string | null;
}
