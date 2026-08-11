/**
 * Plaid implementation of FinancialDataProvider. Sandbox by default.
 * Only this file may import the Plaid SDK.
 */
import "server-only";
import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  type AccountBase,
  type Transaction as PlaidTransaction,
} from "plaid";
import type {
  ConnectResult,
  FinancialDataProvider,
  ProviderAccount,
  ProviderTransaction,
  TransactionSyncResult,
} from "./types";

function client(): PlaidApi {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error(
      "Plaid is not configured — set PLAID_CLIENT_ID and PLAID_SECRET (sandbox keys are free).",
    );
  }
  const env = process.env.PLAID_ENV ?? "sandbox";
  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[env],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": clientId,
          "PLAID-SECRET": secret,
        },
      },
    }),
  );
}

export function isPlaidConfigured(): boolean {
  return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

function mapAccountType(a: AccountBase): ProviderAccount["type"] {
  const type = a.type as string;
  const subtype = (a.subtype as string | null) ?? "";
  if (type === "depository") {
    if (subtype.includes("savings") || subtype === "cd" || subtype === "money market")
      return "savings";
    return "checking";
  }
  if (type === "credit") return "credit_card";
  if (type === "investment") {
    if (/401k|401a|403b|457b|ira|roth|retirement|pension|sep|simple/i.test(subtype))
      return "retirement";
    return "investment";
  }
  if (type === "loan") return "loan";
  return "other";
}

function mapAccount(a: AccountBase): ProviderAccount {
  const type = mapAccountType(a);
  const isLiability = type === "credit_card" || type === "loan";
  // Plaid: depository current = balance held; credit current = amount owed.
  const current = a.balances.current ?? 0;
  return {
    providerAccountId: a.account_id,
    name: a.name,
    officialName: a.official_name ?? null,
    type,
    mask: a.mask ?? null,
    currentBalance: current,
    availableBalance: a.balances.available ?? null,
    creditLimit: isLiability ? (a.balances.limit ?? null) : null,
    currency: a.balances.iso_currency_code ?? "USD",
  };
}

function mapTransaction(t: PlaidTransaction): ProviderTransaction {
  return {
    providerTransactionId: t.transaction_id,
    providerAccountId: t.account_id,
    // authorized_date is closer to when the purchase happened; date = posted
    date: t.authorized_date ?? t.date,
    merchant: t.merchant_name ?? t.name,
    rawDescription: t.name,
    amount: t.amount, // Plaid: positive = outflow — matches our convention
    currency: t.iso_currency_code ?? "USD",
    pending: t.pending,
    pendingProviderTransactionId: t.pending_transaction_id ?? null,
    providerCategoryPrimary: t.personal_finance_category?.primary ?? null,
    providerCategoryDetailed: t.personal_finance_category?.detailed ?? null,
    raw: t,
  };
}

export class PlaidFinancialDataProvider implements FinancialDataProvider {
  readonly name = "plaid";

  async createLinkToken(): Promise<{ linkToken: string }> {
    const res = await client().linkTokenCreate({
      user: { client_user_id: "meridian-single-user" },
      client_name: "Meridian",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
    });
    return { linkToken: res.data.link_token };
  }

  async connectAccount(publicToken: string): Promise<ConnectResult> {
    const c = client();
    const exchange = await c.itemPublicTokenExchange({
      public_token: publicToken,
    });
    const accessToken = exchange.data.access_token;
    const itemId = exchange.data.item_id;

    let institutionName = "Unknown Institution";
    let institutionId: string | null = null;
    try {
      const item = await c.itemGet({ access_token: accessToken });
      institutionId = item.data.item.institution_id ?? null;
      if (institutionId) {
        const inst = await c.institutionsGetById({
          institution_id: institutionId,
          country_codes: [CountryCode.Us],
        });
        institutionName = inst.data.institution.name;
      }
    } catch {
      // institution metadata is cosmetic; never fail the connection for it
    }

    return {
      accessToken,
      providerItemId: itemId,
      institution: {
        providerInstitutionId: institutionId,
        name: institutionName,
      },
    };
  }

  async syncAccounts(accessToken: string): Promise<ProviderAccount[]> {
    const res = await client().accountsGet({ access_token: accessToken });
    return res.data.accounts.map(mapAccount);
  }

  async syncTransactions(
    accessToken: string,
    cursor: string | null,
  ): Promise<TransactionSyncResult> {
    const res = await client().transactionsSync({
      access_token: accessToken,
      cursor: cursor ?? undefined,
      count: 500,
    });
    return {
      added: res.data.added.map(mapTransaction),
      modified: res.data.modified.map(mapTransaction),
      removedProviderTransactionIds: res.data.removed.map(
        (r) => r.transaction_id,
      ),
      nextCursor: res.data.next_cursor || null,
      hasMore: res.data.has_more,
    };
  }

  async disconnectAccount(accessToken: string): Promise<void> {
    await client().itemRemove({ access_token: accessToken });
  }
}
