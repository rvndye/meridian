export const dynamic = "force-dynamic";

import { Card, PageHeader, Badge } from "@/components/ui";
import { getCategoryRules, getSyncEvents, getConnections } from "@/lib/repo";
import { isPlaidConfigured } from "@/lib/providers/plaid";
import { fmtDate, timeAgo } from "@/lib/format";
import { RulesList } from "./rules-list";
import { LogoutButton } from "./logout-button";
import { authEnabled } from "@/lib/auth";

export default async function SettingsPage() {
  const [rules, events, connections] = await Promise.all([
    getCategoryRules(),
    getSyncEvents(10),
    getConnections(),
  ]);

  return (
    <>
      <PageHeader
        title="Settings"
        actions={authEnabled() ? <LogoutButton /> : undefined}
      />
      <div className="flex flex-col gap-4">
        {!authEnabled() && (
          <Card>
            <p className="text-[13px] text-ink-2">
              <span className="font-semibold text-warn">
                Authentication is off.
              </span>{" "}
              Fine for local development — set{" "}
              <code className="rounded bg-surface-2 px-1 font-mono text-[12px]">
                APP_PASSWORD
              </code>{" "}
              and{" "}
              <code className="rounded bg-surface-2 px-1 font-mono text-[12px]">
                SESSION_SECRET
              </code>{" "}
              before deploying anywhere.
            </p>
          </Card>
        )}
        <Card title="Data connections">
          <div className="flex flex-col gap-2 text-[13px]">
            {connections.map((c) => (
              <div key={c.id} className="flex items-center gap-3">
                <span className="font-medium capitalize">{c.provider}</span>
                {c.provider === "demo" && <Badge tone="accent">demo data</Badge>}
                {c.status === "active" ? (
                  <Badge tone="good">Active</Badge>
                ) : c.status === "error" ? (
                  <Badge tone="bad">Error</Badge>
                ) : (
                  <Badge tone="neutral">Disconnected</Badge>
                )}
                <span className="ml-auto text-[12px] text-ink-3">
                  synced {timeAgo(c.lastSyncedAt?.toISOString() ?? null)}
                </span>
              </div>
            ))}
            <p className="mt-2 border-t border-border pt-3 text-[12px] text-ink-3">
              {isPlaidConfigured()
                ? "Plaid is configured — connect banks from the Accounts page."
                : "Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET to .env.local (free sandbox keys) to connect real institutions."}
            </p>
          </div>
        </Card>

        <Card
          title="Category rules"
          subtitle="Created when you recategorize a merchant; they override provider categories"
        >
          <RulesList rules={rules} />
        </Card>

        <Card title="Sync log">
          <div className="divide-y divide-border">
            {events.map((e) => (
              <div key={e.id} className="flex items-center gap-3 py-2 text-[12px]">
                <span className="tnum text-ink-3">
                  {fmtDate(e.startedAt.slice(0, 10))}
                </span>
                {e.status === "success" ? (
                  <Badge tone="good">success</Badge>
                ) : e.status === "error" ? (
                  <Badge tone="bad">error</Badge>
                ) : (
                  <Badge tone="warn">running</Badge>
                )}
                <span className="text-ink-2">{e.message ?? "—"}</span>
              </div>
            ))}
            {events.length === 0 && (
              <p className="text-[13px] text-ink-2">No syncs yet.</p>
            )}
          </div>
        </Card>

        <Card title="Privacy">
          <ul className="list-inside list-disc text-[13px] leading-6 text-ink-2">
            <li>Your financial data lives in your own database — nowhere else.</li>
            <li>No analytics, no tracking, no advertising, no data sales.</li>
            <li>
              Bank credentials are never seen or stored by this app; connections
              happen inside the provider&apos;s secure widget and only an
              encrypted access token is kept.
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}
