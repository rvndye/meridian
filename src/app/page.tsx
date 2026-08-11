export const dynamic = "force-dynamic";

import Link from "next/link";
import {
  getAccounts,
  getSnapshots,
  getSyncStatus,
  getTransactions,
  todayIso,
} from "@/lib/data";
import {
  lastMonths,
  monthRange,
  monthlyCashFlow,
  netWorth,
  netWorthSeries,
  spendingByCategory,
  totalsForRange,
} from "@/lib/domain/analytics";
import { categoryName } from "@/lib/domain/categories";
import { categoryColor } from "@/lib/colors";
import { fmtCurrencyWhole, fmtDateShort, timeAgo } from "@/lib/format";
import { Amount, Badge, Card, Delta, PageHeader, StatCard } from "@/components/ui";
import { SyncNowButton } from "@/components/sync-now";
import { HBarList } from "@/components/hbar-list";
import {
  CategoryDonut,
  IncomeSpendingChart,
  NetWorthChart,
} from "@/components/charts";

export default async function DashboardPage() {
  const [accounts, txns, snapshots, sync] = await Promise.all([
    getAccounts(),
    getTransactions(),
    getSnapshots(),
    getSyncStatus(),
  ]);
  const today = todayIso();
  const ym = today.slice(0, 7);

  const nw = netWorth(accounts);

  // Net worth deltas: vs start of month, vs start of year
  const nwDates = [...new Set(snapshots.map((s) => s.date))].sort();
  const series = netWorthSeries(accounts, snapshots, nwDates);
  const monthStartPoint = [...series]
    .reverse()
    .find((p) => p.date < `${ym}-01`);
  const yearStartPoint = [...series]
    .reverse()
    .find((p) => p.date < `${today.slice(0, 4)}-01-01`);
  const nwMonthDelta = monthStartPoint
    ? nw.netWorth - monthStartPoint.netWorth
    : 0;
  const nwYearDelta = yearStartPoint ? nw.netWorth - yearStartPoint.netWorth : 0;

  const { start: mStart } = monthRange(ym);
  const mtd = totalsForRange(txns, mStart, today);
  const flow = monthlyCashFlow(txns, lastMonths(ym, 6));

  const topCats = spendingByCategory(txns, mStart, today).filter(
    (c) => c.amount > 0,
  );
  const donutData = [
    ...topCats.slice(0, 5).map((c) => ({
      categoryId: c.categoryId,
      name: categoryName(c.categoryId),
      amount: Math.round(c.amount),
    })),
    ...(topCats.length > 5
      ? [
          {
            categoryId: "__other",
            name: "Other",
            amount: Math.round(
              topCats.slice(5).reduce((s, c) => s + c.amount, 0),
            ),
          },
        ]
      : []),
  ];

  const recent = [...txns]
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .slice(0, 8);
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Last synchronized ${timeAgo(sync.lastSyncedAt)}`}
        actions={<SyncNowButton />}
      />

      {/* Net worth hero + KPI row */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="md:col-span-2">
          <div className="text-[12px] font-medium text-ink-2">Net worth</div>
          <div className="mt-1 text-[40px] font-semibold leading-tight tracking-tight">
            {fmtCurrencyWhole(nw.netWorth)}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            <Delta value={nwMonthDelta} suffix="this month" />
            <Delta value={nwYearDelta} suffix="this year" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-4 border-t border-border pt-3 text-[13px]">
            <div>
              <div className="text-ink-3">Assets</div>
              <div className="tnum font-semibold">{fmtCurrencyWhole(nw.assets)}</div>
            </div>
            <div>
              <div className="text-ink-3">Liabilities</div>
              <div className="tnum font-semibold">
                {fmtCurrencyWhole(nw.liabilities)}
              </div>
            </div>
          </div>
        </Card>
        <StatCard
          label="Income this month"
          value={fmtCurrencyWhole(mtd.income)}
        />
        <StatCard
          label="Spending this month"
          value={fmtCurrencyWhole(mtd.spending)}
        >
          <Delta value={mtd.net} upIsGood suffix="net cash flow" />
        </StatCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card
          className="lg:col-span-3"
          title="Net worth over time"
          subtitle="Monthly balances across all accounts"
        >
          <NetWorthChart
            data={series.map((p) => ({ date: p.date, netWorth: p.netWorth }))}
            height={240}
          />
        </Card>
        <Card
          className="lg:col-span-2"
          title="Cash flow"
          subtitle="Income vs spending, last 6 months"
          actions={
            <Link href="/spending" className="text-[12px] font-medium text-accent">
              Details →
            </Link>
          }
        >
          <IncomeSpendingChart data={flow} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card
          className="lg:col-span-3"
          title="Top spending this month"
          actions={
            <Link href="/spending" className="text-[12px] font-medium text-accent">
              All categories →
            </Link>
          }
        >
          <HBarList
            items={topCats.slice(0, 6).map((c) => ({
              key: c.categoryId,
              label: categoryName(c.categoryId),
              value: c.amount,
              color: categoryColor(c.categoryId),
            }))}
          />
        </Card>
        <Card className="lg:col-span-2" title="Spending mix">
          <CategoryDonut data={donutData} />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {donutData.map((d) => (
              <span
                key={d.categoryId}
                className="flex items-center gap-1.5 text-[11px] text-ink-2"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    background:
                      d.categoryId === "__other"
                        ? "#c9c7c0"
                        : categoryColor(d.categoryId),
                  }}
                />
                {d.name}
              </span>
            ))}
          </div>
        </Card>
      </div>

      <Card
        className="mt-4"
        title="Recent transactions"
        actions={
          <Link href="/transactions" className="text-[12px] font-medium text-accent">
            View all →
          </Link>
        }
      >
        <div className="divide-y divide-border">
          {recent.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: categoryColor(t.categoryId) }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">
                  {t.merchant}
                </div>
                <div className="text-[11px] text-ink-3">
                  {fmtDateShort(t.date)} · {accountName.get(t.accountId)}
                  {t.isTransfer && " · transfer"}
                </div>
              </div>
              {t.status === "pending" && <Badge tone="warn">Pending</Badge>}
              <Amount value={t.amount} className="text-[13px]" />
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
