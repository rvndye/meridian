export const dynamic = "force-dynamic";

import { getAccounts, getSnapshots, getTransactions, todayIso } from "@/lib/data";
import {
  cardActivity,
  monthRange,
  netWorth,
  netWorthSeries,
} from "@/lib/domain/analytics";
import { isLiability } from "@/lib/domain/types";
import { fmtCurrency, fmtCurrencyWhole } from "@/lib/format";
import { Card, Delta, PageHeader, StatCard } from "@/components/ui";
import { NetWorthChart } from "@/components/charts";
import { HBarList } from "@/components/hbar-list";
import { SERIES } from "@/lib/colors";

export default async function NetWorthPage() {
  const [accounts, snapshots, txns] = await Promise.all([
    getAccounts(),
    getSnapshots(),
    getTransactions(),
  ]);
  const today = todayIso();
  const ym = today.slice(0, 7);
  const nw = netWorth(accounts);

  const dates = [...new Set(snapshots.map((s) => s.date))].sort();
  const series = netWorthSeries(accounts, snapshots, dates);
  const monthStart = [...series].reverse().find((p) => p.date < `${ym}-01`);
  const yearStart = [...series]
    .reverse()
    .find((p) => p.date < `${today.slice(0, 4)}-01-01`);

  const assets = accounts.filter((a) => !isLiability(a) && a.status !== "disconnected");
  const liabilities = accounts.filter(
    (a) => isLiability(a) && a.status !== "disconnected",
  );

  // Credit card view: charged vs paid this month
  const cardIds = new Set(accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  const { start } = monthRange(ym);
  const activity = cardActivity(txns, cardIds, start, today);

  return (
    <>
      <PageHeader title="Net Worth" subtitle="Assets minus liabilities across every connected account" />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Net worth"
          value={fmtCurrencyWhole(nw.netWorth)}
          delta={monthStart ? nw.netWorth - monthStart.netWorth : undefined}
          deltaSuffix="this month"
        />
        <StatCard label="Total assets" value={fmtCurrencyWhole(nw.assets)} />
        <StatCard
          label="Total liabilities"
          value={fmtCurrencyWhole(nw.liabilities)}
        />
      </div>

      <Card className="mt-4" title="Net worth over time">
        <NetWorthChart
          data={series.map((p) => ({ date: p.date, netWorth: p.netWorth }))}
          height={300}
        />
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-2">
          {yearStart && (
            <span className="flex items-center gap-1.5">
              Change this year:
              <Delta value={nw.netWorth - yearStart.netWorth} />
            </span>
          )}
          {monthStart && (
            <span className="flex items-center gap-1.5">
              Change this month:
              <Delta value={nw.netWorth - monthStart.netWorth} />
            </span>
          )}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Assets" subtitle={fmtCurrencyWhole(nw.assets)}>
          <HBarList
            items={assets
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
        <Card title="Liabilities" subtitle={fmtCurrencyWhole(nw.liabilities)}>
          <HBarList
            items={liabilities
              .sort((a, b) => b.currentBalance - a.currentBalance)
              .map((a) => ({
                key: a.id,
                label: a.name,
                sub: a.institutionName,
                value: a.currentBalance,
                color: SERIES.red,
              }))}
          />
          {liabilities.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <h3 className="mb-2 text-[12px] font-semibold text-ink-2">
                Credit cards this month
              </h3>
              <div className="flex flex-col gap-1.5 text-[13px]">
                {liabilities
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
