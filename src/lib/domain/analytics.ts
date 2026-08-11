/**
 * Pure financial analytics. Every number the dashboard or the AI assistant
 * shows is computed here, from Transaction/Account/BalanceSnapshot arrays.
 * No I/O — the same functions run against mock data, the database, and tests.
 *
 * Rules enforced throughout:
 *  - Transfers and credit-card payments count as neither income nor spending.
 *  - Spending = outflows in expense categories, NET of refunds to those
 *    categories (a refunded purchase reduces the category, not income).
 *  - Income = inflows in income categories.
 *  - Pending transactions are included by default (callers can filter).
 */
import {
  type Account,
  type BalanceSnapshot,
  type RecurringCadence,
  type RecurringItem,
  type Transaction,
  isLiability,
} from "./types";
import { categoryKind } from "./categories";

// ---------- date helpers (string math on YYYY-MM-DD; no TZ surprises) ----------

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

export function monthRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { start: `${ym}-01`, end: `${ym}-${String(lastDay).padStart(2, "0")}` };
}

/** Inclusive date-range test on ISO date strings. */
export function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

/** Last N whole months ending at `endYm`, oldest first. */
export function lastMonths(endYm: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addMonths(endYm, i - (n - 1)));
}

// ---------- classification ----------

export function isSpending(t: Transaction): boolean {
  if (t.isTransfer) return false;
  return categoryKind(t.categoryId) === "expense";
}

export function isIncome(t: Transaction): boolean {
  if (t.isTransfer) return false;
  return categoryKind(t.categoryId) === "income" && t.amount < 0;
}

// ---------- core aggregates ----------

export interface Totals {
  income: number; // positive number
  spending: number; // positive number (net of refunds)
  net: number; // income - spending
}

export function totalsForRange(
  txns: Transaction[],
  start: string,
  end: string,
): Totals {
  let income = 0;
  let spending = 0;
  for (const t of txns) {
    if (!inRange(t.date, start, end)) continue;
    if (isIncome(t)) income += -t.amount;
    else if (isSpending(t)) spending += t.amount; // refunds (<0) net out
  }
  return { income, spending, net: income - spending };
}

export interface MonthlyFlow {
  month: string; // YYYY-MM
  income: number;
  spending: number;
  net: number;
}

export function monthlyCashFlow(
  txns: Transaction[],
  months: string[],
): MonthlyFlow[] {
  return months.map((month) => {
    const { start, end } = monthRange(month);
    const t = totalsForRange(txns, start, end);
    return { month, income: t.income, spending: t.spending, net: t.net };
  });
}

export interface CategorySpend {
  categoryId: string;
  amount: number; // net of refunds; can be negative if refunds exceed spend
  count: number;
}

export function spendingByCategory(
  txns: Transaction[],
  start: string,
  end: string,
): CategorySpend[] {
  const map = new Map<string, CategorySpend>();
  for (const t of txns) {
    if (!inRange(t.date, start, end) || !isSpending(t)) continue;
    const cur = map.get(t.categoryId) ?? {
      categoryId: t.categoryId,
      amount: 0,
      count: 0,
    };
    cur.amount += t.amount;
    cur.count += 1;
    map.set(t.categoryId, cur);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

export interface IncomeBySource {
  categoryId: string;
  amount: number;
  count: number;
}

export function incomeByCategory(
  txns: Transaction[],
  start: string,
  end: string,
): IncomeBySource[] {
  const map = new Map<string, IncomeBySource>();
  for (const t of txns) {
    if (!inRange(t.date, start, end) || !isIncome(t)) continue;
    const cur = map.get(t.categoryId) ?? {
      categoryId: t.categoryId,
      amount: 0,
      count: 0,
    };
    cur.amount += -t.amount;
    cur.count += 1;
    map.set(t.categoryId, cur);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

export interface MerchantSpend {
  merchant: string;
  amount: number;
  count: number;
}

export function spendingByMerchant(
  txns: Transaction[],
  start: string,
  end: string,
  limit = 10,
): MerchantSpend[] {
  const map = new Map<string, MerchantSpend>();
  for (const t of txns) {
    if (!inRange(t.date, start, end) || !isSpending(t)) continue;
    const key = t.merchant;
    const cur = map.get(key) ?? { merchant: key, amount: 0, count: 0 };
    cur.amount += t.amount;
    cur.count += 1;
    map.set(key, cur);
  }
  return [...map.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

// ---------- net worth ----------

export interface NetWorthSummary {
  assets: number;
  liabilities: number;
  netWorth: number;
}

export function netWorth(accounts: Account[]): NetWorthSummary {
  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    if (a.status === "disconnected") continue;
    if (isLiability(a)) liabilities += a.currentBalance;
    else assets += a.currentBalance;
  }
  return { assets, liabilities, netWorth: assets - liabilities };
}

export interface NetWorthPoint {
  date: string;
  assets: number;
  liabilities: number;
  netWorth: number;
}

/**
 * Net worth over time from balance snapshots. Snapshots are per-account; for
 * each requested date we take each account's latest snapshot on or before it.
 */
export function netWorthSeries(
  accounts: Account[],
  snapshots: BalanceSnapshot[],
  dates: string[],
): NetWorthPoint[] {
  const byAccount = new Map<string, BalanceSnapshot[]>();
  for (const s of snapshots) {
    const arr = byAccount.get(s.accountId) ?? [];
    arr.push(s);
    byAccount.set(s.accountId, arr);
  }
  for (const arr of byAccount.values()) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
  }
  return dates.map((date) => {
    let assets = 0;
    let liabilities = 0;
    for (const a of accounts) {
      const snaps = byAccount.get(a.id);
      if (!snaps) continue;
      let bal: number | null = null;
      for (const s of snaps) {
        if (s.date <= date) bal = s.balance;
        else break;
      }
      if (bal === null) continue;
      if (isLiability(a)) liabilities += bal;
      else assets += bal;
    }
    return { date, assets, liabilities, netWorth: assets - liabilities };
  });
}

// ---------- credit cards ----------

export interface CardActivity {
  accountId: string;
  charges: number; // purchases this range (excludes payments)
  payments: number; // inflows to the card that are payments
  refunds: number;
}

export function cardActivity(
  txns: Transaction[],
  cardAccountIds: Set<string>,
  start: string,
  end: string,
): Map<string, CardActivity> {
  const out = new Map<string, CardActivity>();
  for (const id of cardAccountIds) {
    out.set(id, { accountId: id, charges: 0, payments: 0, refunds: 0 });
  }
  for (const t of txns) {
    if (!cardAccountIds.has(t.accountId)) continue;
    if (!inRange(t.date, start, end)) continue;
    const row = out.get(t.accountId)!;
    if (t.isTransfer || t.categoryId === "credit_card_payment") {
      // payment arriving at the card is an inflow (negative amount)
      if (t.amount < 0) row.payments += -t.amount;
    } else if (t.amount > 0) {
      row.charges += t.amount;
    } else {
      row.refunds += -t.amount;
    }
  }
  return out;
}

// ---------- period comparison ----------

export interface CategoryComparison {
  categoryId: string;
  current: number;
  previous: number;
  change: number;
  pctChange: number | null; // null when previous == 0
}

export function compareSpendingByCategory(
  txns: Transaction[],
  currentStart: string,
  currentEnd: string,
  prevStart: string,
  prevEnd: string,
): CategoryComparison[] {
  const cur = new Map(
    spendingByCategory(txns, currentStart, currentEnd).map((c) => [
      c.categoryId,
      c.amount,
    ]),
  );
  const prev = new Map(
    spendingByCategory(txns, prevStart, prevEnd).map((c) => [
      c.categoryId,
      c.amount,
    ]),
  );
  const ids = new Set([...cur.keys(), ...prev.keys()]);
  return [...ids]
    .map((categoryId) => {
      const c = cur.get(categoryId) ?? 0;
      const p = prev.get(categoryId) ?? 0;
      return {
        categoryId,
        current: c,
        previous: p,
        change: c - p,
        pctChange: p !== 0 ? (c - p) / p : null,
      };
    })
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

// ---------- recurring detection ----------

const CADENCES: { cadence: RecurringCadence; days: number; tolerance: number }[] =
  [
    { cadence: "weekly", days: 7, tolerance: 2 },
    { cadence: "biweekly", days: 14, tolerance: 3 },
    { cadence: "monthly", days: 30, tolerance: 6 },
    { cadence: "quarterly", days: 91, tolerance: 10 },
    { cadence: "yearly", days: 365, tolerance: 20 },
  ];

const ANNUAL_FACTOR: Record<RecurringCadence, number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
};

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000,
  );
}

function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Detect recurring merchants: ≥3 occurrences, stable interval matching a known
 * cadence, and reasonably stable amounts (median absolute deviation ≤ 25% of
 * the median amount, with an absolute floor for small amounts).
 */
export function detectRecurring(
  txns: Transaction[],
  today: string,
): RecurringItem[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (t.isTransfer || t.status === "pending") continue;
    // categoryId in the key keeps e.g. a salary stream separate from a
    // one-off bonus paid by the same employer
    const key = `${t.merchant.toLowerCase()}|${t.categoryId}|${t.amount > 0 ? "out" : "in"}`;
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }

  const items: RecurringItem[] = [];
  for (const group of groups.values()) {
    if (group.length < 3) continue;
    group.sort((a, b) => a.date.localeCompare(b.date));
    const gaps: number[] = [];
    for (let i = 1; i < group.length; i++) {
      gaps.push(daysBetween(group[i - 1].date, group[i].date));
    }
    const medGap = median(gaps);
    const match = CADENCES.find(
      (c) => Math.abs(medGap - c.days) <= c.tolerance,
    );
    if (!match) continue;
    // every gap must be near the cadence (allow one skipped cycle)
    const irregular = gaps.filter(
      (g) =>
        Math.abs(g - match.days) > match.tolerance &&
        Math.abs(g - match.days * 2) > match.tolerance * 2,
    );
    if (irregular.length > 0) continue;

    const amounts = group.map((t) => Math.abs(t.amount));
    const medAmount = median(amounts);
    const mad = median(amounts.map((a) => Math.abs(a - medAmount)));
    if (mad > Math.max(medAmount * 0.25, 5)) continue;

    const last = group[group.length - 1];
    const nextExpected = addDays(last.date, match.days);
    const sign = last.amount > 0 ? 1 : -1;
    const active = daysBetween(last.date, today) <= match.days * 2 + 15;
    items.push({
      id: `rec_${last.merchant.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${sign > 0 ? "out" : "in"}`,
      merchant: last.merchant,
      categoryId: last.categoryId,
      accountId: last.accountId,
      cadence: match.cadence,
      typicalAmount: sign * medAmount,
      lastDate: last.date,
      nextExpectedDate: nextExpected,
      annualizedCost: sign * medAmount * ANNUAL_FACTOR[match.cadence],
      occurrences: group.length,
      active,
    });
  }
  return items.sort(
    (a, b) => Math.abs(b.annualizedCost) - Math.abs(a.annualizedCost),
  );
}

// ---------- transfer detection ----------

const TRANSFER_KEYWORDS =
  /\b(transfer|xfer|zelle to self|online payment.*thank you|payment thank you|autopay|ach pmt|epay|e-payment|payment received)\b/i;

/**
 * Mark transfers between own accounts and credit-card payments.
 * Two-sided match: opposite amounts, different accounts, within `windowDays`.
 * One-sided fallback: description keywords + a counterpart account type that
 * makes sense (e.g. an inflow on a credit card described as a payment).
 *
 * Returns a NEW array; does not mutate inputs.
 */
export function detectTransfers(
  txns: Transaction[],
  accounts: Account[],
  windowDays = 4,
): Transaction[] {
  const accountType = new Map(accounts.map((a) => [a.id, a.type]));
  const out = txns.map((t) => ({ ...t }));
  const used = new Set<string>();

  // Index outflows by rounded amount for pairing
  const outflows = out.filter((t) => t.amount > 0);
  const inflows = out.filter((t) => t.amount < 0);
  const byAmount = new Map<string, Transaction[]>();
  for (const t of outflows) {
    const key = t.amount.toFixed(2);
    const arr = byAmount.get(key) ?? [];
    arr.push(t);
    byAmount.set(key, arr);
  }

  for (const inflow of inflows) {
    const key = (-inflow.amount).toFixed(2);
    const candidates = byAmount.get(key) ?? [];
    const match = candidates.find(
      (o) =>
        !used.has(o.id) &&
        o.accountId !== inflow.accountId &&
        Math.abs(daysBetween(o.date, inflow.date)) <= windowDays &&
        // pairing requires at least one side to look like a transfer/payment,
        // or the inflow lands on a liability (a payment arriving at a card)
        (TRANSFER_KEYWORDS.test(o.rawDescription) ||
          TRANSFER_KEYWORDS.test(inflow.rawDescription) ||
          o.categoryId === "transfer" ||
          inflow.categoryId === "transfer" ||
          o.categoryId === "credit_card_payment" ||
          inflow.categoryId === "credit_card_payment" ||
          isLiability({ type: accountType.get(inflow.accountId) ?? "other" })),
    );
    if (match) {
      used.add(match.id);
      used.add(inflow.id);
      const toLiability = isLiability({
        type: accountType.get(inflow.accountId) ?? "other",
      });
      const cat = toLiability ? "credit_card_payment" : "transfer";
      for (const side of [match, inflow]) {
        side.isTransfer = true;
        // respect explicit user categorization if present
        if (side.categorySource !== "user") side.categoryId = cat;
      }
      match.transferPairId = inflow.id;
      inflow.transferPairId = match.id;
    }
  }

  // One-sided fallback: obvious transfer descriptions with no matched pair
  for (const t of out) {
    if (t.isTransfer || used.has(t.id) || t.categorySource === "user") continue;
    const type = accountType.get(t.accountId) ?? "other";
    if (
      t.amount < 0 &&
      isLiability({ type }) &&
      TRANSFER_KEYWORDS.test(t.rawDescription)
    ) {
      t.isTransfer = true;
      t.categoryId = "credit_card_payment";
    } else if (
      TRANSFER_KEYWORDS.test(t.rawDescription) &&
      /transfer|xfer/i.test(t.rawDescription)
    ) {
      t.isTransfer = true;
      t.categoryId = "transfer";
    }
  }

  return out;
}
