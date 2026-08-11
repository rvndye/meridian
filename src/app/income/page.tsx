import { getTransactions, todayIso } from "@/lib/data";
import {
  incomeByCategory,
  monthlyCashFlow,
  monthRange,
  totalsForRange,
} from "@/lib/domain/analytics";
import { categoryName } from "@/lib/domain/categories";
import { categoryColor, INCOME_COLOR } from "@/lib/colors";
import { resolvePeriod } from "@/lib/range";
import { fmtCurrencyWhole, fmtDate } from "@/lib/format";
import { Amount, Card, PageHeader, StatCard } from "@/components/ui";
import { RangePicker } from "@/components/range-picker";
import { HBarList } from "@/components/hbar-list";
import { MonthlyBars } from "@/components/charts";
import { isIncome } from "@/lib/domain/analytics";

export default async function IncomePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const txns = await getTransactions();
  const today = todayIso();
  const period = resolvePeriod(today, params, "12m");

  const totals = totalsForRange(txns, period.start, period.end);
  const sources = incomeByCategory(txns, period.start, period.end);
  const trend = monthlyCashFlow(txns, period.months).map((m) => ({
    month: m.month,
    amount: m.income,
  }));

  const ym = today.slice(0, 7);
  const mtd = totalsForRange(txns, monthRange(ym).start, today);
  const ytd = totalsForRange(txns, `${today.slice(0, 4)}-01-01`, today);

  const recentIncome = txns
    .filter((t) => isIncome(t) && t.date >= period.start && t.date <= period.end)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

  return (
    <>
      <PageHeader
        title="Income"
        subtitle={`${period.label} · transfers between your accounts never count as income`}
        actions={<RangePicker defaultKey="12m" />}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label={`Total income (${period.label.toLowerCase()})`}
          value={fmtCurrencyWhole(totals.income)}
        />
        <StatCard label="This month" value={fmtCurrencyWhole(mtd.income)} />
        <StatCard label="Year to date" value={fmtCurrencyWhole(ytd.income)} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Monthly income">
          <MonthlyBars data={trend} color={INCOME_COLOR} name="Income" />
        </Card>
        <Card title="Income by source">
          <HBarList
            items={sources.map((s) => ({
              key: s.categoryId,
              label: categoryName(s.categoryId),
              sub: `${s.count}×`,
              value: s.amount,
              color: categoryColor(s.categoryId),
            }))}
          />
        </Card>
      </div>

      <Card className="mt-4" title="Recent income">
        <div className="divide-y divide-border">
          {recentIncome.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: categoryColor(t.categoryId) }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{t.merchant}</div>
                <div className="text-[11px] text-ink-3">
                  {fmtDate(t.date)} · {categoryName(t.categoryId)}
                </div>
              </div>
              <Amount value={t.amount} className="text-[13px]" />
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
