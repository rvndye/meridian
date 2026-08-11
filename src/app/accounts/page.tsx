export const dynamic = "force-dynamic";

import { getAccounts } from "@/lib/data";
import { fmtCurrency, timeAgo } from "@/lib/format";
import { isLiability } from "@/lib/domain/types";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ConnectAccountButton } from "@/components/connect-account";
import { isPlaidConfigured } from "@/lib/providers/plaid";
import { Landmark } from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  credit_card: "Credit card",
  investment: "Investment",
  retirement: "Retirement",
  loan: "Loan",
  other: "Other",
};

export default async function AccountsPage() {
  const accounts = await getAccounts();
  const institutions = [...new Set(accounts.map((a) => a.institutionName))];

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle={`${accounts.length} accounts across ${institutions.length} institutions`}
        actions={<ConnectAccountButton configured={isPlaidConfigured()} />}
      />

      <div className="flex flex-col gap-4">
        {institutions.map((inst) => {
          const list = accounts.filter((a) => a.institutionName === inst);
          return (
            <Card key={inst}>
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface-2">
                  <Landmark size={14} className="text-ink-2" />
                </span>
                <h2 className="text-[14px] font-semibold">{inst}</h2>
              </div>
              <div className="divide-y divide-border">
                {list.map((a) => (
                  <div
                    key={a.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium">{a.name}</span>
                        {a.mask && (
                          <span className="text-[11px] text-ink-3">
                            ····{a.mask}
                          </span>
                        )}
                        <Badge tone="neutral">{TYPE_LABELS[a.type]}</Badge>
                        {a.status === "active" ? (
                          <Badge tone="good">Connected</Badge>
                        ) : a.status === "error" ? (
                          <Badge tone="bad">Error</Badge>
                        ) : (
                          <Badge tone="neutral">Disconnected</Badge>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-ink-3">
                        Last synced {timeAgo(a.lastSyncedAt)}
                        {a.availableBalance !== null &&
                          a.type === "credit_card" &&
                          ` · ${fmtCurrency(a.availableBalance)} available credit`}
                        {a.creditLimit !== null &&
                          ` · ${fmtCurrency(a.creditLimit)} limit`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="tnum text-[15px] font-semibold">
                        {fmtCurrency(a.currentBalance)}
                      </div>
                      <div className="text-[11px] text-ink-3">
                        {isLiability(a) ? "owed" : "balance"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
