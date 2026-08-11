import { getTransactions, todayIso } from "@/lib/data";
import {
  compareSpendingByCategory,
  monthlyCashFlow,
  spendingByCategory,
  spendingByMerchant,
  totalsForRange,
} from "@/lib/domain/analytics";
import { categoryName } from "@/lib/domain/categories";
import { categoryColor, SPENDING_COLOR } from "@/lib/colors";
import { resolvePeriod } from "@/lib/range";
import { fmtCurrency, fmtCurrencyWhole } from "@/lib/format";
import { Card, Delta, PageHeader, StatCard } from "@/components/ui";
import { RangePicker } from "@/components/range-picker";
import { HBarList } from "@/components/hbar-list";
import { MonthlyBars } from "@/components/charts";

export default async function SpendingPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const txns = await getTransactions();
  const today = todayIso();
  const period = resolvePeriod(today, params, "1m");

  const totals = totalsForRange(txns, period.start, period.end);
  const prevTotals = totalsForRange(txns, period.prevStart, period.prevEnd);
  const cats = spendingByCategory(txns, period.start, period.end);
  const merchants = spendingByMerchant(txns, period.start, period.end, 8);
  const comparison = compareSpendingByCategory(
    txns,
    period.start,
    period.end,
    period.prevStart,
    period.prevEnd,
  );
  const trend = monthlyCashFlow(txns, period.months).map((m) => ({
    month: m.month,
    amount: m.spending,
  }));
  const txnCount = txns.filter(
    (t) =>
      t.date >= period.start &&
      t.date <= period.end &&
      !t.isTransfer &&
      t.amount > 0,
  ).length;

  return (
    <>
      <PageHeader
        title="Spending"
        subtitle={`${period.label} · transfers and card payments excluded`}
        actions={<RangePicker defaultKey="1m" />}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Total spending"
          value={fmtCurrencyWhole(totals.spending)}
          delta={totals.spending - prevTotals.spending}
          upIsGood={false}
          deltaSuffix="vs previous period"
        />
        <StatCard label="Transactions" value={String(txnCount)} />
        <StatCard
          label="Largest category"
          value={cats[0] ? categoryName(cats[0].categoryId) : "—"}
        >
          {cats[0] && (
            <span className="tnum text-[12px] text-ink-2">
              {fmtCurrency(cats[0].amount)}
            </span>
          )}
        </StatCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Spending by category">
          <HBarList
            items={cats
              .filter((c) => c.amount > 0)
              .map((c) => ({
                key: c.categoryId,
                label: categoryName(c.categoryId),
                sub: `${c.count}×`,
                value: c.amount,
                color: categoryColor(c.categoryId),
              }))}
          />
        </Card>
        <Card title="Spending over time" subtitle="Monthly totals">
          <MonthlyBars data={trend} color={SPENDING_COLOR} name="Spending" />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card
          title="vs previous period"
          subtitle="Biggest category changes"
        >
          <div className="flex flex-col gap-2">
            {comparison
              .filter((c) => Math.abs(c.change) >= 1)
              .slice(0, 8)
              .map((c) => (
                <div
                  key={c.categoryId}
                  className="flex items-center justify-between gap-3 text-[13px]"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: categoryColor(c.categoryId) }}
                    />
                    {categoryName(c.categoryId)}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="tnum text-ink-3">
                      {fmtCurrencyWhole(c.previous)} → {fmtCurrencyWhole(c.current)}
                    </span>
                    <Delta value={c.change} pct={c.pctChange} upIsGood={false} />
                  </span>
                </div>
              ))}
          </div>
        </Card>
        <Card title="Top merchants">
          <HBarList
            items={merchants.map((m) => ({
              key: m.merchant,
              label: m.merchant,
              sub: `${m.count}×`,
              value: m.amount,
              color: SPENDING_COLOR,
            }))}
          />
        </Card>
      </div>
    </>
  );
}
