/**
 * FinancialDataProvider — the seam between this app and any aggregation
 * provider (Plaid today; swappable later). Nothing outside src/lib/providers
 * may import provider SDKs.
 *
 * Amount convention matches the domain: >0 outflow, <0 inflow.
 */

export interface ProviderInstitution {
  providerInstitutionId: string | null;
  name: string;
}

export interface ProviderAccount {
  providerAccountId: string;
  name: string;
  officialName: string | null;
  /** Normalized to our AccountType vocabulary. */
  type:
    | "checking"
    | "savings"
    | "credit_card"
    | "investment"
    | "retirement"
    | "loan"
    | "other";
  mask: string | null;
  currentBalance: number;
  availableBalance: number | null;
  creditLimit: number | null;
  currency: string;
}

export interface ProviderTransaction {
  providerTransactionId: string;
  providerAccountId: string;
  date: string; // YYYY-MM-DD
  merchant: string;
  rawDescription: string;
  amount: number;
  currency: string;
  pending: boolean;
  /** Provider's ID of the pending precursor, when this is the posted form. */
  pendingProviderTransactionId: string | null;
  /** Provider's own category labels, preserved verbatim. */
  providerCategoryPrimary: string | null;
  providerCategoryDetailed: string | null;
  /** Full raw payload for the provider_data column. */
  raw: unknown;
}

export interface TransactionSyncResult {
  added: ProviderTransaction[];
  modified: ProviderTransaction[];
  removedProviderTransactionIds: string[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ConnectResult {
  accessToken: string;
  providerItemId: string;
  institution: ProviderInstitution;
}

export interface FinancialDataProvider {
  readonly name: string;
  /** Begin an account-connection flow (returns a client link token). */
  createLinkToken(): Promise<{ linkToken: string }>;
  /** Complete the connection flow. */
  connectAccount(publicToken: string): Promise<ConnectResult>;
  /** Current accounts + balances for a connection. */
  syncAccounts(accessToken: string): Promise<ProviderAccount[]>;
  /** Incremental transaction sync from a cursor (null = from the beginning). */
  syncTransactions(
    accessToken: string,
    cursor: string | null,
  ): Promise<TransactionSyncResult>;
  /** Revoke the connection at the provider. */
  disconnectAccount(accessToken: string): Promise<void>;
}
