export const dynamic = "force-dynamic";

import Link from "next/link";
import {
  getAccounts,
  getAssets,
  getAssetValuations,
  getSnapshots,
  getTransactions,
} from "@/lib/repo";
import { todayIso } from "@/lib/data";
import {
  cardActivity,
  monthRange,
  netWorthSeries,
} from "@/lib/domain/analytics";
import {
  assetValueSeries,
  netWorthBreakdown,
} from "@/lib/domain/assets";
import { isLiability } from "@/lib/domain/types";
import type { AssetValuation } from "@/lib/domain/types";
import { fmtCurrency, fmtCurrencyWhole } from "@/lib/format";
import { Card, Delta, PageHeader, StatCard } from "@/components/ui";
import { NetWorthChart } from "@/components/charts";
import { HBarList } from "@/components/hbar-list";
import { SERIES } from "@/lib/colors";

const ASSET_TYPE_LABELS: Record<string, string> = {
  real_estate: "Real estate",
  vehicle: "Vehicles",
  jewelry: "Jewelry",
  collectible: "Collectibles",
  business: "Business interests",
  cash: "Cash held outside accounts",
  other: "Other assets",
};

export default async function NetWorthPage() {
  const [accounts, snapshots, txns, assets, valuations] = await Promise.all([
    getAccounts(),
    getSnapshots(),
    getTransactions(),
    getAssets(),
    getAssetValuations(),
  ]);
  const today = todayIso();
  const ym = today.slice(0, 7);

  const valuationsByAsset = new Map<string, AssetValuation[]>();
  for (const v of valuations) {
    const arr = valuationsByAsset.get(v.assetId) ?? [];
    arr.push(v);
    valuationsByAsset.set(v.assetId, arr);
  }
  const assetsWithValues = assets.map((asset) => ({
    asset,
    value: asset.currentValue,
  }));
  const breakdown = netWorthBreakdown(accounts, assetsWithValues);

  // Time series: financial accounts from balance snapshots + tracked assets
  // from their valuation history (carried forward).
  const dates = [...new Set(snapshots.map((s) => s.date))].sort();
  const financialSeries = netWorthSeries(accounts, snapshots, dates);
  const series = financialSeries.map((p) => {
    let assetTotal = 0;
    for (const a of assets) {
      const hist = valuationsByAsset.get(a.id) ?? [];
      assetTotal += assetValueSeries(a, hist, [p.date])[0].value;
    }
    return { date: p.date, netWorth: p.netWorth + assetTotal };
  });
  const current = breakdown.netWorth;
  const monthStart = [...series].reverse().find((p) => p.date < `${ym}-01`);
  const yearStart = [...series]
    .reverse()
    .find((p) => p.date < `${today.slice(0, 4)}-01-01`);

  const financialAccounts = accounts.filter(
    (a) => !isLiability(a) && a.status !== "disconnected",
  );
  const liabilityAccounts = accounts.filter(
    (a) => isLiability(a) && a.status !== "disconnected",
  );

  const cardIds = new Set(
    accounts.filter((a) => a.type === "credit_card").map((a) => a.id),
  );
  const { start } = monthRange(ym);
  const activity = cardActivity(txns, cardIds, start, today);

  // Contribution bars: each asset class as a share of total assets
  const contribution = [
    {
      key: "financial",
      label: "Financial accounts",
      value: breakdown.financialAssets,
      color: SERIES.blue,
    },
    ...Object.entries(breakdown.otherAssetsByType).map(([type, value], i) => ({
      key: type,
      label: ASSET_TYPE_LABELS[type] ?? type,
      value,
      color: [SERIES.violet, SERIES.aqua, SERIES.orange, SERIES.magenta][i % 4],
    })),
  ].filter((c) => c.value > 0);

  return (
    <>
      <PageHeader
        title="Net Worth"
        subtitle="Financial accounts plus tracked assets, minus liabilities"
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Net worth"
          value={fmtCurrencyWhole(current)}
          delta={monthStart ? current - monthStart.netWorth : undefined}
          deltaSuffix="this month"
        />
        <StatCard
          label="Financial assets"
          value={fmtCurrencyWhole(breakdown.financialAssets)}
        />
        <StatCard
          label="Other assets"
          value={fmtCurrencyWhole(breakdown.otherAssets)}
        />
        <StatCard
          label="Total assets"
          value={fmtCurrencyWhole(breakdown.totalAssets)}
        />
        <StatCard
          label="Liabilities"
          value={fmtCurrencyWhole(breakdown.liabilities)}
        />
      </div>

      <Card className="mt-4" title="Net worth over time">
        <NetWorthChart data={series} height={300} />
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-2">
          {yearStart && (
            <span className="flex items-center gap-1.5">
              Change this year:
              <Delta value={current - yearStart.netWorth} />
            </span>
          )}
          {monthStart && (
            <span className="flex items-center gap-1.5">
              Change this month:
              <Delta value={current - monthStart.netWorth} />
            </span>
          )}
        </div>
      </Card>

      <Card
        className="mt-4"
        title="Asset contribution"
        subtitle={`${fmtCurrencyWhole(breakdown.totalAssets)} in total assets`}
        actions={
          <Link href="/assets" className="text-[12px] font-medium text-accent">
            Manage assets →
          </Link>
        }
      >
        <HBarList items={contribution} />
        {breakdown.liabilities > 0 && (
          <div className="mt-3 flex justify-between border-t border-border pt-3 text-[13px]">
            <span className="text-ink-2">Liabilities</span>
            <span className="tnum font-medium text-neg">
              −{fmtCurrencyWhole(breakdown.liabilities)}
            </span>
          </div>
        )}
        <div className="mt-2 flex justify-between text-[13px] font-semibold">
          <span>Net worth</span>
          <span className="tnum">{fmtCurrencyWhole(current)}</span>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card
          title="Financial accounts"
          subtitle={fmtCurrencyWhole(breakdown.financialAssets)}
        >
          <HBarList
            items={financialAccounts
              .sort((a, b) => b.currentBalance - a.currentBalance)
              .map((a) => ({
                key: a.id,
                label: a.name,
                sub: a.institutionName,
                value: a.currentBalance,
                color: SERIES.blue,
              }))}
          />
        </Card>
        <Card
          title="Liabilities"
          subtitle={fmtCurrencyWhole(breakdown.liabilities)}
        >
          <HBarList
            items={liabilityAccounts
              .sort((a, b) => b.currentBalance - a.currentBalance)
              .map((a) => ({
                key: a.id,
                label: a.name,
                sub: a.institutionName,
                value: a.currentBalance,
                color: SERIES.red,
              }))}
          />
          {liabilityAccounts.filter((a) => a.type === "credit_card").length >
            0 && (
            <div className="mt-4 border-t border-border pt-3">
              <h3 className="mb-2 text-[12px] font-semibold text-ink-2">
                Credit cards this month
              </h3>
              <div className="flex flex-col gap-1.5 text-[13px]">
                {liabilityAccounts
                  .filter((a) => a.type === "credit_card")
                  .map((a) => {
                    const act = activity.get(a.id);
                    return (
                      <div key={a.id} className="flex justify-between gap-2">
                        <span className="text-ink-2">{a.name}</span>
                        <span className="tnum">
                          charged {fmtCurrency(act?.charges ?? 0)} · paid{" "}
                          {fmtCurrency(act?.payments ?? 0)}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
