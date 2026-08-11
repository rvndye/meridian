import { describe, expect, it } from "vitest";
import {
  compareSpendingByCategory,
  detectRecurring,
  detectTransfers,
  incomeByCategory,
  monthlyCashFlow,
  netWorth,
  netWorthSeries,
  spendingByCategory,
  totalsForRange,
} from "../src/lib/domain/analytics";
import { CARD, CHECKING, SAVINGS, txn } from "./fixtures";

describe("income vs spending", () => {
  it("computes income and spending, excluding transfers", () => {
    const txns = [
      txn({ accountId: "checking", date: "2026-07-01", amount: -3000, categoryId: "salary" }),
      txn({ accountId: "checking", date: "2026-07-02", amount: 1200, categoryId: "housing" }),
      txn({ accountId: "checking", date: "2026-07-03", amount: 80, categoryId: "groceries" }),
      // marked transfer must count as neither
      txn({ accountId: "checking", date: "2026-07-04", amount: 500, categoryId: "transfer", isTransfer: true }),
      txn({ accountId: "savings", date: "2026-07-04", amount: -500, categoryId: "transfer", isTransfer: true }),
    ];
    const t = totalsForRange(txns, "2026-07-01", "2026-07-31");
    expect(t.income).toBe(3000);
    expect(t.spending).toBe(1280);
    expect(t.net).toBe(1720);
  });

  it("does not count an inflow in an expense category as income", () => {
    const txns = [
      txn({ accountId: "card", date: "2026-07-05", amount: -40, categoryId: "shopping" }), // refund
    ];
    const t = totalsForRange(txns, "2026-07-01", "2026-07-31");
    expect(t.income).toBe(0);
  });

  it("breaks income down by source", () => {
    const txns = [
      txn({ accountId: "checking", date: "2026-07-01", amount: -3000, categoryId: "salary" }),
      txn({ accountId: "checking", date: "2026-07-15", amount: -3000, categoryId: "salary" }),
      txn({ accountId: "savings", date: "2026-07-28", amount: -80, categoryId: "interest" }),
    ];
    const sources = incomeByCategory(txns, "2026-07-01", "2026-07-31");
    expect(sources).toEqual([
      { categoryId: "salary", amount: 6000, count: 2 },
      { categoryId: "interest", amount: 80, count: 1 },
    ]);
  });
});

describe("refunds", () => {
  it("nets refunds against category spending, not income", () => {
    const txns = [
      txn({ accountId: "card", date: "2026-07-01", amount: 120, categoryId: "shopping" }),
      txn({ accountId: "card", date: "2026-07-05", amount: -30, categoryId: "shopping" }),
    ];
    const t = totalsForRange(txns, "2026-07-01", "2026-07-31");
    expect(t.spending).toBe(90);
    expect(t.income).toBe(0);
    const cats = spendingByCategory(txns, "2026-07-01", "2026-07-31");
    expect(cats.find((c) => c.categoryId === "shopping")?.amount).toBe(90);
  });
});

describe("pending transactions", () => {
  it("includes pending transactions in totals", () => {
    const txns = [
      txn({ accountId: "card", date: "2026-07-30", amount: 55, categoryId: "restaurants", status: "pending" }),
      txn({ accountId: "card", date: "2026-07-15", amount: 45, categoryId: "restaurants" }),
    ];
    const t = totalsForRange(txns, "2026-07-01", "2026-07-31");
    expect(t.spending).toBe(100);
  });
});

describe("date boundaries", () => {
  it("treats range bounds as inclusive and respects month edges", () => {
    const txns = [
      txn({ accountId: "checking", date: "2026-06-30", amount: 10, categoryId: "other" }),
      txn({ accountId: "checking", date: "2026-07-01", amount: 20, categoryId: "other" }),
      txn({ accountId: "checking", date: "2026-07-31", amount: 40, categoryId: "other" }),
      txn({ accountId: "checking", date: "2026-08-01", amount: 80, categoryId: "other" }),
    ];
    const july = totalsForRange(txns, "2026-07-01", "2026-07-31");
    expect(july.spending).toBe(60);
  });

  it("handles leap-year February in monthly totals", () => {
    const txns = [
      txn({ accountId: "checking", date: "2028-02-29", amount: 25, categoryId: "other" }),
    ];
    const flow = monthlyCashFlow(txns, ["2028-02"]);
    expect(flow[0].spending).toBe(25);
  });
});

describe("monthly cash flow", () => {
  it("aggregates by calendar month", () => {
    const txns = [
      txn({ accountId: "checking", date: "2026-06-15", amount: -1000, categoryId: "salary" }),
      txn({ accountId: "checking", date: "2026-06-20", amount: 400, categoryId: "groceries" }),
      txn({ accountId: "checking", date: "2026-07-15", amount: -1000, categoryId: "salary" }),
      txn({ accountId: "checking", date: "2026-07-20", amount: 600, categoryId: "groceries" }),
    ];
    const flow = monthlyCashFlow(txns, ["2026-06", "2026-07"]);
    expect(flow).toEqual([
      { month: "2026-06", income: 1000, spending: 400, net: 600 },
      { month: "2026-07", income: 1000, spending: 600, net: 400 },
    ]);
  });
});

describe("transfer detection", () => {
  it("pairs equal-and-opposite transfers between own accounts", () => {
    const txns = [
      txn({
        accountId: "checking", date: "2026-07-01", amount: 500,
        merchant: "Transfer", rawDescription: "ONLINE TRANSFER TO SAV",
        categoryId: "other",
      }),
      txn({
        accountId: "savings", date: "2026-07-01", amount: -500,
        merchant: "Transfer", rawDescription: "ONLINE TRANSFER FROM CHK",
        categoryId: "other",
      }),
    ];
    const out = detectTransfers(txns, [CHECKING, SAVINGS, CARD]);
    expect(out.every((t) => t.isTransfer)).toBe(true);
    expect(out[0].transferPairId).toBe(out[1].id);
    const t = totalsForRange(out, "2026-07-01", "2026-07-31");
    expect(t.income).toBe(0);
    expect(t.spending).toBe(0);
  });

  it("classifies credit-card payments so purchases are not double counted", () => {
    const txns = [
      // the underlying purchase — the only real spending
      txn({ accountId: "card", date: "2026-07-02", amount: 300, categoryId: "shopping" }),
      // payment: checking -> card
      txn({
        accountId: "checking", date: "2026-07-26", amount: 300,
        merchant: "Card Payment", rawDescription: "CARD AUTOPAY PPD",
        categoryId: "other",
      }),
      txn({
        accountId: "card", date: "2026-07-26", amount: -300,
        merchant: "Payment", rawDescription: "AUTOMATIC PAYMENT - THANK YOU",
        categoryId: "other",
      }),
    ];
    const out = detectTransfers(txns, [CHECKING, SAVINGS, CARD]);
    const t = totalsForRange(out, "2026-07-01", "2026-07-31");
    expect(t.spending).toBe(300); // purchase counted exactly once
    expect(t.income).toBe(0); // payment arriving at card is not income
    const payment = out.find((x) => x.rawDescription.includes("THANK YOU"));
    expect(payment?.categoryId).toBe("credit_card_payment");
  });

  it("does not pair unrelated equal amounts without transfer signals", () => {
    const txns = [
      txn({ accountId: "checking", date: "2026-07-01", amount: 50, merchant: "Cafe", rawDescription: "CAFE", categoryId: "restaurants" }),
      txn({ accountId: "savings", date: "2026-07-02", amount: -50, merchant: "Interest", rawDescription: "INTEREST PAYMENT", categoryId: "interest" }),
    ];
    const out = detectTransfers(txns, [CHECKING, SAVINGS]);
    expect(out.every((t) => !t.isTransfer)).toBe(true);
  });

  it("never overrides an explicit user categorization", () => {
    const txns = [
      txn({
        accountId: "checking", date: "2026-07-01", amount: 500,
        rawDescription: "ONLINE TRANSFER TO SAV",
        categoryId: "personal", categorySource: "user",
      }),
      txn({
        accountId: "savings", date: "2026-07-01", amount: -500,
        rawDescription: "ONLINE TRANSFER FROM CHK", categoryId: "transfer",
      }),
    ];
    const out = detectTransfers(txns, [CHECKING, SAVINGS]);
    const userTxn = out.find((t) => t.categorySource === "user");
    expect(userTxn?.categoryId).toBe("personal");
  });
});

describe("net worth", () => {
  it("subtracts liabilities from assets", () => {
    const nw = netWorth([
      { ...CHECKING, currentBalance: 5000 },
      { ...SAVINGS, currentBalance: 10000 },
      { ...CARD, currentBalance: 2000 },
    ]);
    expect(nw.assets).toBe(15000);
    expect(nw.liabilities).toBe(2000);
    expect(nw.netWorth).toBe(13000);
  });

  it("excludes disconnected accounts", () => {
    const nw = netWorth([
      { ...CHECKING, currentBalance: 5000 },
      { ...SAVINGS, currentBalance: 10000, status: "disconnected" },
    ]);
    expect(nw.assets).toBe(5000);
  });

  it("builds a time series from per-account snapshots", () => {
    const accounts = [CHECKING, CARD];
    const snapshots = [
      { accountId: "checking", date: "2026-06-30", balance: 4000 },
      { accountId: "checking", date: "2026-07-31", balance: 5000 },
      { accountId: "card", date: "2026-06-30", balance: 1000 },
      // card has no July snapshot — carries forward the June value
    ];
    const series = netWorthSeries(accounts, snapshots, ["2026-06-30", "2026-07-31"]);
    expect(series[0].netWorth).toBe(3000);
    expect(series[1].netWorth).toBe(4000);
  });
});

describe("period comparison", () => {
  it("ranks categories by absolute change", () => {
    const txns = [
      txn({ accountId: "card", date: "2026-06-10", amount: 100, categoryId: "groceries" }),
      txn({ accountId: "card", date: "2026-07-10", amount: 400, categoryId: "groceries" }),
      txn({ accountId: "card", date: "2026-06-12", amount: 200, categoryId: "restaurants" }),
      txn({ accountId: "card", date: "2026-07-12", amount: 150, categoryId: "restaurants" }),
    ];
    const cmp = compareSpendingByCategory(
      txns, "2026-07-01", "2026-07-31", "2026-06-01", "2026-06-30",
    );
    expect(cmp[0]).toMatchObject({ categoryId: "groceries", change: 300, pctChange: 3 });
    expect(cmp[1]).toMatchObject({ categoryId: "restaurants", change: -50 });
  });
});

describe("recurring detection", () => {
  it("detects a monthly subscription with stable amounts", () => {
    const dates = ["2026-03-05", "2026-04-05", "2026-05-05", "2026-06-05", "2026-07-05"];
    const txns = dates.map((date) =>
      txn({ accountId: "card", date, amount: 15.49, merchant: "Netflix", categoryId: "subscriptions" }),
    );
    const items = detectRecurring(txns, "2026-07-20");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      merchant: "Netflix",
      cadence: "monthly",
      typicalAmount: 15.49,
      active: true,
    });
    expect(items[0].annualizedCost).toBeCloseTo(185.88, 2);
    expect(items[0].nextExpectedDate > "2026-07-05").toBe(true);
  });

  it("ignores merchants with unstable amounts", () => {
    const txns = [
      txn({ accountId: "card", date: "2026-05-01", amount: 20, merchant: "Cafe" }),
      txn({ accountId: "card", date: "2026-06-01", amount: 90, merchant: "Cafe" }),
      txn({ accountId: "card", date: "2026-07-01", amount: 41, merchant: "Cafe" }),
    ];
    expect(detectRecurring(txns, "2026-07-20")).toHaveLength(0);
  });

  it("marks a stream inactive when it stops occurring", () => {
    const dates = ["2025-10-05", "2025-11-05", "2025-12-05", "2026-01-05"];
    const txns = dates.map((date) =>
      txn({ accountId: "card", date, amount: 9.99, merchant: "OldApp", categoryId: "subscriptions" }),
    );
    const items = detectRecurring(txns, "2026-07-20");
    expect(items[0]?.active).toBe(false);
  });

  it("separates salary from a one-off bonus by the same employer", () => {
    const paydays = ["2026-05-08", "2026-05-22", "2026-06-05", "2026-06-19", "2026-07-03"];
    const txns = [
      ...paydays.map((date) =>
        txn({ accountId: "checking", date, amount: -2000, merchant: "Acme", categoryId: "salary" }),
      ),
      txn({ accountId: "checking", date: "2026-06-12", amount: -5000, merchant: "Acme", categoryId: "bonus" }),
    ];
    const items = detectRecurring(txns, "2026-07-10");
    expect(items).toHaveLength(1);
    expect(items[0].cadence).toBe("biweekly");
  });
});
