/**
 * Fake financial data fixtures. No real financial information anywhere.
 */
import type { Account, Transaction } from "../src/lib/domain/types";

export function acct(overrides: Partial<Account> & { id: string }): Account {
  return {
    institutionName: "Test Bank",
    name: overrides.id,
    officialName: null,
    type: "checking",
    mask: "0000",
    currentBalance: 1000,
    availableBalance: null,
    creditLimit: null,
    currency: "USD",
    status: "active",
    lastSyncedAt: null,
    ...overrides,
  };
}

let seq = 0;

export function txn(
  overrides: Partial<Transaction> & {
    accountId: string;
    date: string;
    amount: number;
  },
): Transaction {
  seq += 1;
  return {
    id: `t${String(seq).padStart(4, "0")}`,
    providerTransactionId: `p${String(seq).padStart(4, "0")}`,
    merchant: "Test Merchant",
    rawDescription: "TEST MERCHANT",
    currency: "USD",
    status: "posted",
    categoryId: "shopping",
    categorySource: "provider",
    providerCategory: "GENERAL_MERCHANDISE",
    isTransfer: false,
    transferPairId: null,
    notes: null,
    ...overrides,
  };
}

export const CHECKING = acct({ id: "checking", type: "checking" });
export const SAVINGS = acct({ id: "savings", type: "savings" });
export const CARD = acct({
  id: "card",
  type: "credit_card",
  currentBalance: 500,
  creditLimit: 5000,
});
