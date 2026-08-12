import type { Category } from "./types";

/**
 * The normalized category taxonomy. Provider categories are mapped onto these;
 * user overrides and merchant rules always resolve to one of these IDs.
 */
export const CATEGORIES: Category[] = [
  // Expenses
  { id: "housing", name: "Housing", kind: "expense" },
  { id: "utilities", name: "Utilities", kind: "expense" },
  { id: "groceries", name: "Groceries", kind: "expense" },
  { id: "restaurants", name: "Restaurants", kind: "expense" },
  { id: "transportation", name: "Transportation", kind: "expense" },
  { id: "travel", name: "Travel", kind: "expense" },
  { id: "shopping", name: "Shopping", kind: "expense" },
  { id: "entertainment", name: "Entertainment", kind: "expense" },
  { id: "healthcare", name: "Healthcare", kind: "expense" },
  { id: "insurance", name: "Insurance", kind: "expense" },
  { id: "education", name: "Education", kind: "expense" },
  { id: "subscriptions", name: "Subscriptions", kind: "expense" },
  { id: "personal", name: "Personal", kind: "expense" },
  { id: "fees", name: "Fees & Charges", kind: "expense" },
  { id: "other", name: "Other", kind: "expense" },
  // Income
  { id: "salary", name: "Salary", kind: "income" },
  { id: "bonus", name: "Bonus", kind: "income" },
  { id: "interest", name: "Interest", kind: "income" },
  { id: "dividends", name: "Dividends", kind: "income" },
  { id: "refunds", name: "Refunds", kind: "income" },
  { id: "other_income", name: "Other Income", kind: "income" },
  // Transfers (excluded from both income and spending)
  { id: "transfer", name: "Transfer", kind: "transfer" },
  { id: "credit_card_payment", name: "Credit Card Payment", kind: "transfer" },
];

export const CATEGORY_BY_ID: ReadonlyMap<string, Category> = new Map(
  CATEGORIES.map((c) => [c.id, c]),
);

export function categoryName(id: string): string {
  return CATEGORY_BY_ID.get(id)?.name ?? "Other";
}

export function categoryKind(id: string): Category["kind"] {
  return CATEGORY_BY_ID.get(id)?.kind ?? "expense";
}

export const EXPENSE_CATEGORIES = CATEGORIES.filter((c) => c.kind === "expense");
export const INCOME_CATEGORIES = CATEGORIES.filter((c) => c.kind === "income");

/**
 * Mapping from Plaid personal_finance_category.primary → normalized category.
 * Kept here (not in the Plaid provider) so any provider can reuse it.
 */
export const PROVIDER_CATEGORY_MAP: Record<string, string> = {
  RENT_AND_UTILITIES: "utilities",
  FOOD_AND_DRINK: "restaurants",
  GENERAL_MERCHANDISE: "shopping",
  TRANSPORTATION: "transportation",
  TRAVEL: "travel",
  ENTERTAINMENT: "entertainment",
  MEDICAL: "healthcare",
  PERSONAL_CARE: "personal",
  GENERAL_SERVICES: "personal",
  HOME_IMPROVEMENT: "housing",
  LOAN_PAYMENTS: "credit_card_payment",
  BANK_FEES: "fees",
  GOVERNMENT_AND_NON_PROFIT: "other",
  INCOME: "salary",
  TRANSFER_IN: "transfer",
  TRANSFER_OUT: "transfer",
};

/** Finer-grained overrides for Plaid `detailed` codes where primary is too coarse. */
export const PROVIDER_DETAILED_MAP: Record<string, string> = {
  FOOD_AND_DRINK_GROCERIES: "groceries",
  RENT_AND_UTILITIES_RENT: "housing",
  INCOME_DIVIDENDS: "dividends",
  INCOME_INTEREST_EARNED: "interest",
  INCOME_WAGES: "salary",
  ENTERTAINMENT_TV_AND_MOVIES: "subscriptions",
  ENTERTAINMENT_MUSIC_AND_AUDIO: "subscriptions",
  GENERAL_SERVICES_INSURANCE: "insurance",
  GENERAL_SERVICES_EDUCATION: "education",
};

export function mapProviderCategory(
  primary: string | null | undefined,
  detailed?: string | null,
): string {
  if (detailed && PROVIDER_DETAILED_MAP[detailed]) {
    return PROVIDER_DETAILED_MAP[detailed];
  }
  if (primary && PROVIDER_CATEGORY_MAP[primary]) {
    return PROVIDER_CATEGORY_MAP[primary];
  }
  // Importers (e.g. Apple Card) may emit already-normalized category ids.
  const asId = primary?.toLowerCase();
  if (asId && CATEGORY_BY_ID.has(asId)) return asId;
  return "other";
}
