/**
 * Pure asset analytics tests — fake data only.
 */
import { describe, expect, it } from "vitest";
import {
  assetAppreciation,
  assetEquity,
  assetValueSeries,
  effectiveAssetValue,
  liquidBreakdown,
  netWorthBreakdown,
} from "../src/lib/domain/assets";
import type { Account, Asset, AssetValuation } from "../src/lib/domain/types";

function asset(overrides: Partial<Asset>): Asset {
  return {
    id: "asset_1",
    name: "Primary Residence",
    assetType: "real_estate",
    description: null,
    address: "123 Main St",
    purchaseDate: "2024-06-01",
    purchasePrice: 450000,
    currentValue: 0,
    valuationMethod: "manual",
    currency: "USD",
    details: null,
    liabilityAccountId: null,
    createdAt: "2025-08-01T00:00:00Z",
    updatedAt: "2025-08-01T00:00:00Z",
    ...overrides,
  };
}

let valSeq = 0;
function val(
  date: string,
  value: number,
  source: "manual" | "automated",
  extra: Partial<AssetValuation> = {},
): AssetValuation {
  valSeq += 1;
  return {
    id: `v_${date}_${source}`,
    assetId: "asset_1",
    valuationDate: date,
    value,
    valueLow: null,
    valueHigh: null,
    source,
    notes: null,
    createdAt: `2026-08-12T00:00:${String(valSeq % 60).padStart(2, "0")}Z`,
    ...extra,
  };
}

function account(overrides: Partial<Account>): Account {
  return {
    id: "acc_1",
    institutionName: "Bank",
    name: "Checking",
    officialName: null,
    type: "checking",
    mask: null,
    currentBalance: 10000,
    availableBalance: null,
    creditLimit: null,
    currency: "USD",
    status: "active",
    lastSyncedAt: null,
    ...overrides,
  };
}

describe("effective asset value", () => {
  const history = [
    val("2025-08-01", 490000, "manual"),
    val("2026-01-15", 505000, "manual"),
    val("2026-08-01", 512400, "automated", {
      valueLow: 480000,
      valueHigh: 548000,
    }),
    val("2026-08-12", 525000, "manual"),
  ];

  it("manual method uses the latest manual valuation", () => {
    const e = effectiveAssetValue(asset({ valuationMethod: "manual" }), history);
    expect(e.value).toBe(525000);
    expect(e.source).toBe("manual");
  });

  it("automated method uses the latest automated estimate", () => {
    const e = effectiveAssetValue(
      asset({ valuationMethod: "automated" }),
      history,
    );
    expect(e.value).toBe(512400);
    expect(e.automated?.valueLow).toBe(480000);
    expect(e.automated?.valueHigh).toBe(548000);
  });

  it("hybrid prefers the manual override and exposes both values", () => {
    const e = effectiveAssetValue(asset({ valuationMethod: "hybrid" }), history);
    expect(e.value).toBe(525000);
    expect(e.source).toBe("manual");
    expect(e.automated?.value).toBe(512400);
    expect(e.manual?.value).toBe(525000);
  });

  it("hybrid falls back to the estimate when no manual entry exists", () => {
    const autoOnly = history.filter((v) => v.source === "automated");
    const e = effectiveAssetValue(asset({ valuationMethod: "hybrid" }), autoOnly);
    expect(e.value).toBe(512400);
    expect(e.source).toBe("automated");
  });

  it("same-day valuations: the most recently recorded one wins", () => {
    const sameDay = [
      val("2026-08-12", 490000, "manual", { createdAt: "2026-08-12T09:00:00Z" }),
      val("2026-08-12", 525000, "manual", { createdAt: "2026-08-12T15:00:00Z" }),
    ];
    const e = effectiveAssetValue(asset({ valuationMethod: "manual" }), sameDay);
    expect(e.value).toBe(525000);
  });

  it("returns zero with no valuations", () => {
    const e = effectiveAssetValue(asset({}), []);
    expect(e.value).toBe(0);
    expect(e.source).toBe("none");
  });

  it("historical records are never overwritten by newer ones", () => {
    // Adding the Aug-2026 manual valuation must not remove earlier entries.
    expect(history).toHaveLength(4);
    expect(history[0].value).toBe(490000);
  });
});

describe("asset value over time", () => {
  const history = [
    val("2025-08-01", 490000, "manual"),
    val("2026-01-15", 505000, "manual"),
    val("2026-08-12", 525000, "manual"),
  ];

  it("carries the latest valuation forward between records", () => {
    const series = assetValueSeries(asset({}), history, [
      "2025-07-01",
      "2025-09-01",
      "2026-03-01",
      "2026-08-31",
    ]);
    expect(series.map((p) => p.value)).toEqual([0, 490000, 505000, 525000]);
  });

  it("computes appreciation over a window", () => {
    const a = assetAppreciation(asset({}), history, "2025-09-01", "2026-08-31");
    expect(a.startValue).toBe(490000);
    expect(a.endValue).toBe(525000);
    expect(a.change).toBe(35000);
  });
});

describe("net worth with assets", () => {
  const accounts = [
    account({ id: "chk", currentBalance: 100000 }),
    account({ id: "sav", type: "savings", currentBalance: 25000 }),
    account({
      id: "cc",
      type: "credit_card",
      name: "Card",
      currentBalance: 4000,
    }),
    account({
      id: "mortgage",
      type: "loan",
      name: "Mortgage",
      currentBalance: 350000,
    }),
  ];
  const house = asset({ id: "house", currentValue: 525000 });
  const car = asset({
    id: "car",
    name: "Car",
    assetType: "vehicle",
    currentValue: 25000,
  });

  it("separates financial assets, other assets, and liabilities", () => {
    const b = netWorthBreakdown(accounts, [
      { asset: house, value: 525000 },
      { asset: car, value: 25000 },
    ]);
    expect(b.financialAssets).toBe(125000);
    expect(b.otherAssets).toBe(550000);
    expect(b.totalAssets).toBe(675000);
    expect(b.liabilities).toBe(354000);
    expect(b.netWorth).toBe(675000 - 354000);
    expect(b.otherAssetsByType.real_estate).toBe(525000);
    expect(b.otherAssetsByType.vehicle).toBe(25000);
  });

  it("does not double-count: accounts stay financial, assets stay tracked", () => {
    // A Plaid checking account is never an "asset" row and vice versa —
    // the same money can only enter through one of the two inputs.
    const b = netWorthBreakdown(accounts, []);
    expect(b.otherAssets).toBe(0);
    expect(b.totalAssets).toBe(b.financialAssets);
  });

  it("ignores disconnected accounts", () => {
    const b = netWorthBreakdown(
      [...accounts, account({ id: "old", status: "disconnected", currentBalance: 999999 })],
      [],
    );
    expect(b.financialAssets).toBe(125000);
  });

  it("computes property equity against a linked mortgage", () => {
    const { equity, liabilityBalance } = assetEquity(525000, 350000);
    expect(equity).toBe(175000);
    expect(liabilityBalance).toBe(350000);
  });

  it("equity equals full value when nothing is linked", () => {
    expect(assetEquity(25000, null).equity).toBe(25000);
  });

  it("computes the liquid share from cash-like holdings", () => {
    const b = liquidBreakdown(accounts, [
      { asset: house, value: 525000 },
      {
        asset: asset({ id: "safe", assetType: "cash", name: "Safe cash" }),
        value: 5000,
      },
    ]);
    expect(b.liquid).toBe(130000); // checking + savings + cash asset
    expect(b.totalAssets).toBe(655000);
    expect(b.share).toBeCloseTo(130000 / 655000);
  });
});
