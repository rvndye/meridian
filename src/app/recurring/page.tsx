export const dynamic = "force-dynamic";

import { getAccounts, getRecurring } from "@/lib/data";
import { categoryName } from "@/lib/domain/categories";
import { categoryColor } from "@/lib/colors";
import { fmtCurrency, fmtCurrencyWhole, fmtDate } from "@/lib/format";
import { Badge, Card, PageHeader, StatCard } from "@/components/ui";

const CADENCE_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

export default async function RecurringPage() {
  const [items, accounts] = await Promise.all([getRecurring(), getAccounts()]);
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));

  const expenses = items.filter((i) => i.typicalAmount > 0);
  const incomeItems = items.filter((i) => i.typicalAmount < 0);
  const activeExpenses = expenses.filter((i) => i.active);
  const monthlyTotal = activeExpenses.reduce(
    (s, i) => s + i.annualizedCost / 12,
    0,
  );
  const subscriptions = activeExpenses.filter(
    (i) => i.categoryId === "subscriptions",
  );

  return (
    <>
      <PageHeader
        title="Subscriptions & Recurring"
        subtitle="Detected automatically from repeated merchants with stable amounts and cadence"
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Recurring spend / month"
          value={fmtCurrencyWhole(monthlyTotal)}
        />
        <StatCard
          label="Annualized cost"
          value={fmtCurrencyWhole(
            activeExpenses.reduce((s, i) => s + i.annualizedCost, 0),
          )}
        />
        <StatCard
          label="Subscriptions"
          value={`${subscriptions.length} active`}
        >
          <span className="tnum text-[12px] text-ink-2">
            {fmtCurrency(subscriptions.reduce((s, i) => s + i.annualizedCost, 0))}
            /yr
          </span>
        </StatCard>
      </div>

      <Card className="mt-4" title="Recurring expenses">
        {/* Table scrolls inside its own container on small screens */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-ink-3">
                <th className="pb-2 font-medium">Merchant</th>
                <th className="pb-2 font-medium">Category</th>
                <th className="pb-2 font-medium">Frequency</th>
                <th className="pb-2 font-medium">Account</th>
                <th className="pb-2 text-right font-medium">Typical</th>
                <th className="pb-2 text-right font-medium">Annualized</th>
                <th className="pb-2 text-right font-medium">Next expected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {expenses.map((i) => (
                <tr key={i.id} className={i.active ? "" : "opacity-50"}>
                  <td className="py-2.5 font-medium">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: categoryColor(i.categoryId) }}
                      />
                      {i.merchant}
                      {!i.active && <Badge tone="neutral">Inactive</Badge>}
                    </span>
                  </td>
                  <td className="py-2.5 text-ink-2">
                    {categoryName(i.categoryId)}
                  </td>
                  <td className="py-2.5 text-ink-2">
                    {CADENCE_LABELS[i.cadence]}
                  </td>
                  <td className="py-2.5 text-ink-2">
                    {accountName.get(i.accountId)}
                  </td>
                  <td className="tnum py-2.5 text-right">
                    {fmtCurrency(i.typicalAmount)}
                  </td>
                  <td className="tnum py-2.5 text-right">
                    {fmtCurrency(i.annualizedCost)}
                  </td>
                  <td className="tnum py-2.5 text-right text-ink-2">
                    {i.active ? fmtDate(i.nextExpectedDate) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {incomeItems.length > 0 && (
        <Card className="mt-4" title="Recurring income">
          <div className="divide-y divide-border">
            {incomeItems.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                <div>
                  <span className="font-medium">{i.merchant}</span>
                  <span className="ml-2 text-[11px] text-ink-3">
                    {CADENCE_LABELS[i.cadence]} · next {fmtDate(i.nextExpectedDate)}
                  </span>
                </div>
                <span className="tnum font-medium text-pos">
                  +{fmtCurrency(Math.abs(i.typicalAmount))}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
