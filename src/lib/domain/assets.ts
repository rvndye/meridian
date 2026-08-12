/**
 * Pure asset analytics — same contract as analytics.ts: no I/O, shared by
 * the dashboard pages, the AI tools, and the tests.
 *
 * Valuation semantics:
 *  - The valuation history is the source of truth; "current value" derives
 *    from it according to the asset's valuation method.
 *  - manual    → latest manual valuation
 *  - automated → latest automated valuation
 *  - hybrid    → latest manual valuation when one exists (the user's
 *                override wins), otherwise the latest automated estimate.
 */
import { type Account, isLiability } from "./types";
import type { Asset, AssetValuation } from "./types";

export interface EffectiveValue {
  value: number;
  source: "manual" | "automated" | "none";
  asOf: string | null;
  /** Latest automated estimate, for display alongside a manual override. */
  automated: {
    value: number;
    valueLow: number | null;
    valueHigh: number | null;
    asOf: string;
  } | null;
  /** Latest manual entry. */
  manual: { value: number; asOf: string } | null;
}

function latestBySource(
  valuations: AssetValuation[],
  source: "manual" | "automated",
): AssetValuation | null {
  let best: AssetValuation | null = null;
  for (const v of valuations) {
    if (v.source !== source) continue;
    if (
      !best ||
      v.valuationDate > best.valuationDate ||
      // Same valuation date → the most recently recorded entry wins
      (v.valuationDate === best.valuationDate && v.createdAt >= best.createdAt)
    ) {
      best = v;
    }
  }
  return best;
}

export function effectiveAssetValue(
  asset: Pick<Asset, "valuationMethod">,
  valuations: AssetValuation[],
): EffectiveValue {
  const manual = latestBySource(valuations, "manual");
  const automated = latestBySource(valuations, "automated");
  const auto = automated
    ? {
        value: automated.value,
        valueLow: automated.valueLow,
        valueHigh: automated.valueHigh,
        asOf: automated.valuationDate,
      }
    : null;
  const man = manual ? { value: manual.value, asOf: manual.valuationDate } : null;

  let chosen: AssetValuation | null;
  switch (asset.valuationMethod) {
    case "manual":
      chosen = manual;
      break;
    case "automated":
      chosen = automated;
      break;
    case "hybrid":
      chosen = manual ?? automated;
      break;
  }
  return {
    value: chosen?.value ?? 0,
    source: chosen ? chosen.source : "none",
    asOf: chosen?.valuationDate ?? null,
    automated: auto,
    manual: man,
  };
}

/** Value of one asset on each date (carry latest valuation ≤ date forward). */
export function assetValueSeries(
  asset: Pick<Asset, "valuationMethod">,
  valuations: AssetValuation[],
  dates: string[],
): { date: string; value: number }[] {
  return dates.map((date) => {
    const upTo = valuations.filter((v) => v.valuationDate <= date);
    return { date, value: effectiveAssetValue(asset, upTo).value };
  });
}

/** Change in effective value across a window (asset appreciation). */
export function assetAppreciation(
  asset: Pick<Asset, "valuationMethod">,
  valuations: AssetValuation[],
  startDate: string,
  endDate: string,
): { startValue: number; endValue: number; change: number } {
  const startValue = effectiveAssetValue(
    asset,
    valuations.filter((v) => v.valuationDate <= startDate),
  ).value;
  const endValue = effectiveAssetValue(
    asset,
    valuations.filter((v) => v.valuationDate <= endDate),
  ).value;
  return { startValue, endValue, change: endValue - startValue };
}

// ---------- net worth with assets ----------

export interface NetWorthBreakdown {
  financialAssets: number;
  otherAssets: number;
  totalAssets: number;
  liabilities: number;
  netWorth: number;
  /** Per-asset-type totals within otherAssets (real_estate, vehicle, …). */
  otherAssetsByType: Record<string, number>;
}

/**
 * Net worth = financial assets (connected accounts) + tracked assets
 * − liabilities. Tracked assets are manual entries and can never overlap
 * Plaid accounts (different tables), so nothing is double-counted.
 */
export function netWorthBreakdown(
  accounts: Account[],
  assetsWithValues: { asset: Asset; value: number }[],
): NetWorthBreakdown {
  let financialAssets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    if (a.status === "disconnected") continue;
    if (isLiability(a)) liabilities += a.currentBalance;
    else financialAssets += a.currentBalance;
  }
  let otherAssets = 0;
  const otherAssetsByType: Record<string, number> = {};
  for (const { asset, value } of assetsWithValues) {
    otherAssets += value;
    otherAssetsByType[asset.assetType] =
      (otherAssetsByType[asset.assetType] ?? 0) + value;
  }
  const totalAssets = financialAssets + otherAssets;
  return {
    financialAssets,
    otherAssets,
    totalAssets,
    liabilities,
    netWorth: totalAssets - liabilities,
    otherAssetsByType,
  };
}

/** Equity in an asset against its linked liability (e.g. home − mortgage). */
export function assetEquity(
  assetValue: number,
  liabilityBalance: number | null,
): { equity: number; liabilityBalance: number } {
  const owed = liabilityBalance ?? 0;
  return { equity: assetValue - owed, liabilityBalance: owed };
}

/**
 * Liquid share of net worth: cash-like balances (checking, savings) plus
 * cash-type tracked assets, over total assets.
 */
export function liquidBreakdown(
  accounts: Account[],
  assetsWithValues: { asset: Asset; value: number }[],
): { liquid: number; totalAssets: number; share: number | null } {
  let liquid = 0;
  for (const a of accounts) {
    if (a.status === "disconnected") continue;
    if (a.type === "checking" || a.type === "savings") {
      liquid += a.currentBalance;
    }
  }
  for (const { asset, value } of assetsWithValues) {
    if (asset.assetType === "cash") liquid += value;
  }
  const { totalAssets } = netWorthBreakdown(accounts, assetsWithValues);
  return {
    liquid,
    totalAssets,
    share: totalAssets > 0 ? liquid / totalAssets : null,
  };
}
