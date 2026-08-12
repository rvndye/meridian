"use client";

/**
 * Apple Card UI: create the manual account, then import statements (PDF or
 * the Wallet CSV export) with a mandatory preview step before anything is
 * written. Documents are parsed server-side in memory and never stored.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { X, Upload, AlertTriangle } from "lucide-react";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { Badge } from "@/components/ui";

const inputCls =
  "rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/30";

const TYPE_LABELS: Record<string, string> = {
  purchase: "Purchase",
  payment: "Payment",
  credit: "Refund/credit",
  interest: "Interest",
  fee: "Fee",
};

export function AddAppleCardButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Apple Card");
  const [mask, setMask] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts/apple-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          mask: /^\d{4}$/.test(mask) ? mask : null,
        }),
      });
      if (!res.ok) throw new Error();
      setOpen(false);
      router.refresh();
    } catch {
      setError("Creating the account failed — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-surface-2"
      >
         Add Apple Card
      </button>
      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-ink/20" onClick={() => setOpen(false)} />
          <div className="absolute left-1/2 top-1/3 w-full max-w-sm -translate-x-1/2 rounded-lg border border-border bg-surface p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Add Apple Card</h2>
              <button onClick={() => setOpen(false)} className="text-ink-3 hover:text-ink" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <p className="mb-3 text-[12px] text-ink-2">
              Apple Card isn&apos;t available through Plaid. Meridian imports
              your monthly statements (PDF) or Wallet CSV exports instead — no
              Apple credentials involved.
            </p>
            <div className="flex flex-col gap-2">
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Account name" />
              <input className={inputCls} value={mask} onChange={(e) => setMask(e.target.value)} placeholder="Last 4 digits (optional)" maxLength={4} />
              {error && <p className="text-[12px] text-neg">{error}</p>}
              <button onClick={create} disabled={busy} className="mt-1 rounded-md bg-ink px-3 py-2 text-[13px] font-medium text-white disabled:opacity-60">
                {busy ? "Creating…" : "Create account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface PreviewRow {
  index: number;
  date: string;
  postedDate: string | null;
  merchant: string;
  description: string;
  amount: number;
  amountCents: number;
  type: string;
  appleCategory: string | null;
  duplicate: boolean;
}

interface Preview {
  source: "apple_card_pdf" | "apple_card_csv";
  fileHash: string;
  alreadyImported: boolean;
  statement: {
    periodStart: string | null;
    periodEnd: string | null;
    statementBalance: number | null;
    uncertainCount: number;
  };
  statementBalanceCents: number | null;
  rows: PreviewRow[];
}

export function ImportStatementButton({ accountId }: { accountId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("accountId", accountId);
      const res = await fetch("/api/imports/apple-card", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/imports/apple-card/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          source: preview.source,
          fileHash: preview.fileHash,
          periodStart: preview.statement.periodStart,
          periodEnd: preview.statement.periodEnd,
          statementBalanceCents: preview.statementBalanceCents,
          uncertainCount: preview.statement.uncertainCount,
          rows: preview.rows.map((r) => ({
            date: r.date,
            postedDate: r.postedDate,
            description: r.description,
            merchant: r.merchant,
            amountCents: r.amountCents,
            type: r.type,
            appleCategory: r.appleCategory,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setPreview(null);
      setDone(
        `Imported ${data.added} new transaction${data.added === 1 ? "" : "s"}` +
          (data.duplicates > 0 ? ` (${data.duplicates} already present)` : ""),
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  const newCount = preview?.rows.filter((r) => !r.duplicate).length ?? 0;

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.csv,application/pdf,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
      <span className="flex items-center gap-2">
        {done && <span className="text-[11px] text-pos">{done}</span>}
        {error && !preview && <span className="text-[11px] text-neg">{error}</span>}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
        >
          <Upload size={12} />
          {busy && !preview ? "Reading…" : "Import statement"}
        </button>
      </span>

      {preview && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-ink/20" onClick={() => setPreview(null)} />
          <div className="absolute left-1/2 top-1/2 flex max-h-[85vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div>
                <h2 className="text-[15px] font-semibold">Review import</h2>
                <p className="text-[12px] text-ink-2">
                  {preview.statement.periodStart && preview.statement.periodEnd
                    ? `Statement ${fmtDate(preview.statement.periodStart)} – ${fmtDate(preview.statement.periodEnd)}`
                    : "Transaction export"}
                  {preview.statement.statementBalance !== null &&
                    ` · balance ${fmtCurrency(preview.statement.statementBalance)}`}
                </p>
              </div>
              <button onClick={() => setPreview(null)} className="text-ink-3 hover:text-ink" aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2 text-[12px]">
              <Badge tone="accent">{newCount} new</Badge>
              {preview.rows.length - newCount > 0 && (
                <Badge tone="neutral">
                  {preview.rows.length - newCount} duplicates (will be skipped)
                </Badge>
              )}
              {preview.alreadyImported && (
                <Badge tone="warn">This exact file was imported before</Badge>
              )}
              {preview.statement.uncertainCount > 0 && (
                <span className="flex items-center gap-1 text-warn">
                  <AlertTriangle size={12} />
                  Some transactions could not be confidently extracted (
                  {preview.statement.uncertainCount} line
                  {preview.statement.uncertainCount === 1 ? "" : "s"} skipped) —
                  review your statement for anything missing.
                </span>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5">
              <table className="w-full text-left text-[12px]">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-border text-[11px] uppercase tracking-wide text-ink-3">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Merchant</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 text-right font-medium">Amount</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.rows.map((r) => (
                    <tr key={r.index} className={clsx(r.duplicate && "opacity-45")}>
                      <td className="tnum whitespace-nowrap py-1.5 pr-3">{fmtDate(r.date)}</td>
                      <td className="max-w-[220px] truncate py-1.5 pr-3">{r.merchant}</td>
                      <td className="py-1.5 pr-3 text-ink-2">{TYPE_LABELS[r.type] ?? r.type}</td>
                      <td className={clsx("tnum py-1.5 pr-3 text-right", r.amount < 0 && "text-pos")}>
                        {r.amount < 0 ? "+" : ""}
                        {fmtCurrency(Math.abs(r.amount))}
                      </td>
                      <td className="py-1.5">
                        {r.duplicate ? (
                          <span className="text-ink-3">already imported</span>
                        ) : (
                          <span className="text-pos">new</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
              <p className="text-[11px] text-ink-3">
                The uploaded file is parsed in memory and not stored. Payments
                and refunds are classified automatically and never count as
                spending or income.
              </p>
              <div className="flex shrink-0 items-center gap-2">
                {error && <span className="text-[12px] text-neg">{error}</span>}
                <button onClick={() => setPreview(null)} className="rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-ink-2">
                  Cancel
                </button>
                <button
                  onClick={commit}
                  disabled={busy || newCount === 0}
                  className="rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
                >
                  {busy
                    ? "Importing…"
                    : newCount === 0
                      ? "Nothing new to import"
                      : `Import ${newCount} transaction${newCount === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
