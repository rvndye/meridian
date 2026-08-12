/**
 * Apple Card statement parsing — pure functions, no I/O.
 *
 * Two inputs are supported:
 *  - the CSV export from Wallet ("Transaction Date,Clearing Date,…")
 *  - the text extracted from a monthly-statement PDF
 *
 * Output rows are normalized to the domain sign convention (>0 outflow /
 * charge, <0 inflow / payment / credit) and then converted into
 * ProviderTransactions with STABLE ids, so the regular sync ingestion path
 * (dedup, rules, transfer detection) handles them like any provider data.
 * Nothing in this module logs statement contents.
 */
import { createHash } from "node:crypto";
import type { ProviderTransaction } from "../providers/types";

export type AppleRowType =
  | "purchase"
  | "payment"
  | "credit"
  | "interest"
  | "fee";

export interface AppleCardRow {
  /** Transaction date, YYYY-MM-DD. */
  date: string;
  /** Clearing/posting date when the source provides one. */
  postedDate: string | null;
  description: string;
  merchant: string;
  /** Cents; >0 charge, <0 payment/credit. */
  amountCents: number;
  type: AppleRowType;
  /** Apple's own category label (CSV only), preserved verbatim. */
  appleCategory: string | null;
}

export interface ParsedStatement {
  rows: AppleCardRow[];
  periodStart: string | null;
  periodEnd: string | null;
  /** "Total Balance" from a PDF statement, in cents, when found. */
  statementBalanceCents: number | null;
  /** Lines that looked like transactions but could not be parsed. */
  uncertainCount: number;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function mdyToIso(mdy: string): string | null {
  const m = mdy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function longDateToIso(text: string): string | null {
  const m = text.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${m[2].padStart(2, "0")}`;
}

/** "$1,234.56" / "-$1,234.56" / "($12.34)" → signed cents. */
function moneyToCents(raw: string): number | null {
  const trimmed = raw.trim();
  const negative = /^[-(]/.test(trimmed) || trimmed.startsWith("−");
  const digits = trimmed.replace(/[^0-9.]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(digits)) return null;
  const cents = Math.round(parseFloat(digits) * 100);
  return negative ? -cents : cents;
}

function classify(description: string, amountCents: number): AppleRowType {
  const d = description.toLowerCase();
  if (/interest charge|interest for/.test(d)) return "interest";
  if (/\bfee\b/.test(d)) return "fee";
  if (
    amountCents < 0 &&
    /payment|ach deposit|balance transfer in/.test(d)
  ) {
    return "payment";
  }
  if (amountCents < 0) return "credit";
  return "purchase";
}

// ---------- CSV (Wallet export) ----------

const CSV_HEADER_PREFIX = "transaction date,clearing date,description";

/** Minimal RFC-4180 line splitter (quoted fields with commas). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function isAppleCardCsv(text: string): boolean {
  const first = text.split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";
  return first.startsWith(CSV_HEADER_PREFIX);
}

/**
 * Wallet CSV columns:
 * Transaction Date, Clearing Date, Description, Merchant, Category, Type,
 * Amount (USD), Purchased By
 * Amounts already follow our sign convention (purchases +, payments −).
 */
export function parseAppleCardCsv(text: string): ParsedStatement {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows: AppleCardRow[] = [];
  let uncertainCount = 0;

  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    if (cols.length < 7) {
      uncertainCount++;
      continue;
    }
    const [txnDate, clearDate, description, merchant, category, type, amount] =
      cols;
    const date = mdyToIso(txnDate);
    const cents = moneyToCents(amount);
    if (!date || cents === null || !description) {
      uncertainCount++;
      continue;
    }
    const typeNorm = type.toLowerCase();
    rows.push({
      date,
      postedDate: mdyToIso(clearDate),
      description,
      merchant: merchant || description,
      amountCents: cents,
      type:
        typeNorm === "payment"
          ? "payment"
          : typeNorm === "credit" || typeNorm === "refund"
            ? "credit"
            : typeNorm === "interest"
              ? "interest"
              : classify(description, cents),
      appleCategory: category || null,
    });
  }

  const dates = rows.map((r) => r.date).sort();
  return {
    rows,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    statementBalanceCents: null,
    uncertainCount,
  };
}

// ---------- PDF statement text ----------

export function looksLikeAppleCardStatement(text: string): boolean {
  return /apple card/i.test(text) && /statement/i.test(text);
}

/**
 * Transaction line shapes seen on Apple Card monthly statements:
 *   08/01/2026 MERCHANT NAME CITY ST 2% $1.00 $49.99
 *   08/05/2026 ACH Deposit Internet Payment ACH Deposit -$1,500.00
 * The optional "N% $x.xx" pair is Daily Cash and is discarded.
 */
const TXN_LINE =
  /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)(?:\s+\d{1,2}%\s+\$[\d,]+\.\d{2})?\s+(-?\(?\$[\d,]+\.\d{2}\)?)$/;

const PERIOD_RANGE =
  /([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\s*[-–—]\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/;

export function parseAppleCardStatementText(text: string): ParsedStatement {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);

  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  let statementBalanceCents: number | null = null;
  let uncertainCount = 0;
  const rows: AppleCardRow[] = [];
  let section: "payments" | "transactions" | "interest" | "other" = "other";

  for (const line of lines) {
    if (!periodStart) {
      const range = line.match(PERIOD_RANGE);
      if (range) {
        periodStart = longDateToIso(range[1]);
        periodEnd = longDateToIso(range[2]);
      }
    }
    if (statementBalanceCents === null) {
      const bal = line.match(/total balance\s+(-?\$[\d,]+\.\d{2})/i);
      if (bal) statementBalanceCents = moneyToCents(bal[1]);
    }

    const lower = line.toLowerCase();
    if (/^payments\b/.test(lower)) {
      section = "payments";
      continue;
    }
    if (/^(transactions|purchases)\b/.test(lower)) {
      section = "transactions";
      continue;
    }
    if (/^interest charged\b/.test(lower)) {
      section = "interest";
      continue;
    }
    if (/^(total daily cash|daily cash|payment information|statement|apple card customer)/.test(lower)) {
      section = "other";
      continue;
    }

    const m = line.match(TXN_LINE);
    if (m) {
      const date = mdyToIso(m[1]);
      const cents = moneyToCents(m[3]);
      const description = m[2].trim();
      // Section totals sometimes match the pattern; skip obvious ones.
      if (/^total\b/i.test(description)) continue;
      if (!date || cents === null || description.length === 0) {
        uncertainCount++;
        continue;
      }
      const type: AppleRowType =
        section === "payments"
          ? "payment"
          : section === "interest"
            ? "interest"
            : classify(description, cents);
      rows.push({
        date,
        postedDate: null,
        description,
        merchant: cleanMerchant(description),
        // Payments/credits on the card are inflows regardless of how the
        // statement prints the sign.
        amountCents:
          type === "payment" || type === "credit"
            ? -Math.abs(cents)
            : cents,
        type,
        appleCategory: null,
      });
      continue;
    }

    // A line that starts like a transaction but didn't parse → uncertain.
    if (/^\d{2}\/\d{2}\/\d{4}\s/.test(line)) uncertainCount++;
  }

  if (!periodStart && rows.length > 0) {
    const dates = rows.map((r) => r.date).sort();
    periodStart = dates[0];
    periodEnd = dates[dates.length - 1];
  }

  return { rows, periodStart, periodEnd, statementBalanceCents, uncertainCount };
}

/** Strip trailing city/state/daily-cash noise from a statement description. */
function cleanMerchant(description: string): string {
  return description
    .replace(/\s+\d{3}-?\d{3}-?\d{4}/g, "") // phone numbers
    .replace(/\s+[A-Z]{2}$/, "") // trailing state code
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------- normalization to ProviderTransactions ----------

/** Map Apple's CSV category labels to the normalized taxonomy. */
export const APPLE_CATEGORY_MAP: Record<string, string> = {
  grocery: "groceries",
  restaurants: "restaurants",
  food_and_drink: "restaurants",
  shopping: "shopping",
  entertainment: "entertainment",
  transportation: "transportation",
  gas: "transportation",
  travel: "travel",
  health: "healthcare",
  services: "personal",
  other: "other",
};

/**
 * Deterministic, stable transaction id. Two genuinely identical rows within
 * ONE upload get distinct occurrence indexes; re-uploads of the same
 * statement (or an overlapping CSV export) regenerate identical ids and are
 * deduplicated by the unique index on provider_transaction_id.
 */
export function appleTransactionId(
  accountId: string,
  row: AppleCardRow,
  occurrence: number,
): string {
  const key = [
    accountId,
    row.date,
    row.amountCents,
    row.description.toLowerCase().replace(/\s+/g, " ").trim(),
    occurrence,
  ].join("|");
  return `apple_${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

export function toProviderTransactions(
  accountId: string,
  rows: AppleCardRow[],
): ProviderTransaction[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const baseKey = `${row.date}|${row.amountCents}|${row.description.toLowerCase()}`;
    const occurrence = seen.get(baseKey) ?? 0;
    seen.set(baseKey, occurrence + 1);

    const isInflowToCard = row.type === "payment";
    const appleCat = row.appleCategory?.toLowerCase() ?? null;
    return {
      providerTransactionId: appleTransactionId(accountId, row, occurrence),
      providerAccountId: accountId,
      date: row.date,
      merchant: row.merchant,
      rawDescription: row.description,
      amount: row.amountCents / 100,
      currency: "USD",
      pending: false,
      pendingProviderTransactionId: null,
      // Payments map to the credit-card-payment category so they are never
      // income/spending even before transfer pairing; purchases carry
      // Apple's category (CSV) for the provider-mapping step.
      providerCategoryPrimary: isInflowToCard
        ? "LOAN_PAYMENTS"
        : row.type === "interest" || row.type === "fee"
          ? "BANK_FEES"
          : appleCat && APPLE_CATEGORY_MAP[appleCat]
            ? APPLE_CATEGORY_MAP[appleCat].toUpperCase()
            : null,
      providerCategoryDetailed: null,
      raw: {
        source: "apple_card_import",
        type: row.type,
        appleCategory: row.appleCategory,
        postedDate: row.postedDate,
      },
      // Preserve Apple's own category verbatim in raw; the normalized one
      // flows through the standard categorize() path.
    } satisfies ProviderTransaction;
  });
}
