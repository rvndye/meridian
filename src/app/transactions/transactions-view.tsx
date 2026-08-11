"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { X, ArrowUpDown, Search } from "lucide-react";
import type { Transaction } from "@/lib/domain/types";
import { CATEGORIES, categoryKind, categoryName } from "@/lib/domain/categories";
import { categoryColor } from "@/lib/colors";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { Amount, Badge } from "@/components/ui";

interface AccountRef {
  id: string;
  name: string;
}

type TypeFilter = "all" | "income" | "expense" | "transfer";
type StatusFilter = "all" | "pending" | "posted";
type SortKey = "date" | "amount" | "merchant";

const PAGE = 100;

const inputCls =
  "rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/30";

export function TransactionsView({
  transactions,
  accounts,
}: {
  transactions: Transaction[];
  accounts: AccountRef[];
}) {
  // Optimistic edits overlay on top of server data; persisted via the API
  const [edits, setEdits] = useState<Record<string, Partial<Transaction>>>({});
  const [query, setQuery] = useState("");
  const [account, setAccount] = useState("all");
  const [category, setCategory] = useState("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Transaction | null>(null);

  const accountName = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name])),
    [accounts],
  );

  const merged = useMemo(
    () => transactions.map((t) => (edits[t.id] ? { ...t, ...edits[t.id] } : t)),
    [transactions, edits],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = merged.filter((t) => {
      if (q && !t.merchant.toLowerCase().includes(q) && !t.rawDescription.toLowerCase().includes(q)) return false;
      if (account !== "all" && t.accountId !== account) return false;
      if (category !== "all" && t.categoryId !== category) return false;
      if (type === "income" && !(t.amount < 0 && !t.isTransfer)) return false;
      if (type === "expense" && !(t.amount > 0 && !t.isTransfer)) return false;
      if (type === "transfer" && !t.isTransfer) return false;
      if (status !== "all" && t.status !== status) return false;
      if (from && t.date < from) return false;
      if (to && t.date > to) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (sortKey === "date")
        return dir * (a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      if (sortKey === "amount") return dir * (a.amount - b.amount);
      return dir * a.merchant.localeCompare(b.merchant);
    });
    return rows;
  }, [merged, query, account, category, type, status, from, to, sortKey, sortDir]);

  const visible = filtered.slice(0, limit);
  const totalShown = filtered.reduce(
    (s, t) => (t.isTransfer ? s : s + (t.amount > 0 ? t.amount : 0)),
    0,
  );

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "merchant" ? "asc" : "desc");
    }
  }

  const [saveState, setSaveState] = useState<
    { kind: "idle" } | { kind: "saving" } | { kind: "saved"; ruleApplied: number } | { kind: "error" }
  >({ kind: "idle" });

  async function saveEdit(id: string, patch: Partial<Transaction>) {
    setSaveState({ kind: "saving" });
    try {
      const res = await fetch(`/api/transactions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant: patch.merchant,
          categoryId: patch.categoryId,
          notes: patch.notes,
          createRule: true,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data: { transaction: Transaction; ruleApplied: number } =
        await res.json();
      setEdits((e) => ({ ...e, [id]: data.transaction }));
      setSelected((s) => (s && s.id === id ? { ...s, ...data.transaction } : s));
      setSaveState({ kind: "saved", ruleApplied: data.ruleApplied });
    } catch {
      setSaveState({ kind: "error" });
    }
  }

  const selectedMerged = selected
    ? { ...selected, ...edits[selected.id] }
    : null;

  return (
    <div>
      {/* Filter row */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            placeholder="Search merchant or description"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={clsx(inputCls, "w-64 pl-8")}
          />
        </div>
        <select value={account} onChange={(e) => setAccount(e.target.value)} className={inputCls}>
          <option value="all">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as TypeFilter)} className={inputCls}>
          <option value="all">Income & expenses</option>
          <option value="expense">Expenses</option>
          <option value="income">Income</option>
          <option value="transfer">Transfers</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={inputCls}>
          <option value="all">Any status</option>
          <option value="posted">Posted</option>
          <option value="pending">Pending</option>
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        <span className="text-[12px] text-ink-3">to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
      </div>

      <div className="mb-3 text-[12px] text-ink-2">
        {filtered.length.toLocaleString()} transactions ·{" "}
        <span className="tnum">{fmtCurrency(totalShown)}</span> spent in view
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wide text-ink-3">
              <Th onClick={() => toggleSort("date")} active={sortKey === "date"}>Date</Th>
              <Th onClick={() => toggleSort("merchant")} active={sortKey === "merchant"}>Merchant</Th>
              <th className="px-4 py-2.5 font-medium">Account</th>
              <th className="px-4 py-2.5 font-medium">Category</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <Th onClick={() => toggleSort("amount")} active={sortKey === "amount"} right>Amount</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((t) => (
              <tr
                key={t.id}
                onClick={() => setSelected(t)}
                className="cursor-pointer transition-colors hover:bg-surface-2"
              >
                <td className="tnum whitespace-nowrap px-4 py-2.5 text-ink-2">{fmtDate(t.date)}</td>
                <td className="max-w-[220px] truncate px-4 py-2.5 font-medium">{t.merchant}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-ink-2">{accountName.get(t.accountId)}</td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  <span className="flex items-center gap-1.5 text-ink-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: categoryColor(t.categoryId) }} />
                    {categoryName(t.categoryId)}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  {t.isTransfer ? (
                    <Badge tone="accent">Transfer</Badge>
                  ) : t.status === "pending" ? (
                    <Badge tone="warn">Pending</Badge>
                  ) : (
                    <span className="text-[12px] text-ink-3">Posted</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  <Amount value={t.amount} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <p className="px-4 py-8 text-center text-[13px] text-ink-3">
            No transactions match these filters.
          </p>
        )}
      </div>
      {filtered.length > limit && (
        <button
          onClick={() => setLimit((l) => l + PAGE)}
          className="mt-3 rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:text-ink"
        >
          Show more ({(filtered.length - limit).toLocaleString()} remaining)
        </button>
      )}

      {/* Detail panel */}
      {selectedMerged && (
        <DetailPanel
          txn={selectedMerged}
          accountName={accountName.get(selectedMerged.accountId) ?? ""}
          onClose={() => {
            setSelected(null);
            setSaveState({ kind: "idle" });
          }}
          onSave={saveEdit}
          saveState={saveState}
        />
      )}
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  right,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  right?: boolean;
}) {
  return (
    <th className={clsx("px-4 py-2.5 font-medium", right && "text-right")}>
      <button
        onClick={onClick}
        className={clsx(
          "inline-flex items-center gap-1 uppercase tracking-wide",
          active ? "text-ink" : "hover:text-ink",
        )}
      >
        {children}
        <ArrowUpDown size={11} />
      </button>
    </th>
  );
}

function DetailPanel({
  txn,
  accountName,
  onClose,
  onSave,
  saveState,
}: {
  txn: Transaction;
  accountName: string;
  onClose: () => void;
  onSave: (id: string, patch: Partial<Transaction>) => void;
  saveState:
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved"; ruleApplied: number }
    | { kind: "error" };
}) {
  const [merchant, setMerchant] = useState(txn.merchant);
  const [categoryId, setCategoryId] = useState(txn.categoryId);
  const [notes, setNotes] = useState(txn.notes ?? "");
  const dirty =
    merchant !== txn.merchant ||
    categoryId !== txn.categoryId ||
    notes !== (txn.notes ?? "");

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/20" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <div className="text-[12px] text-ink-3">{fmtDate(txn.date)}</div>
            <h2 className="text-lg font-semibold">{merchant}</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="mb-5 flex items-baseline gap-3">
          <Amount value={txn.amount} className="text-2xl" />
          {txn.isTransfer ? (
            <Badge tone="accent">Transfer</Badge>
          ) : txn.status === "pending" ? (
            <Badge tone="warn">Pending</Badge>
          ) : (
            <Badge tone="neutral">Posted</Badge>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Field label="Merchant name">
            <input value={merchant} onChange={(e) => setMerchant(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Category">
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputCls}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.kind === "income" ? " (income)" : c.kind === "transfer" ? " (transfer)" : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-ink-3">
              Changing the category creates a rule so future {merchant} transactions follow it.
            </p>
          </Field>
          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={clsx(inputCls, "resize-none")}
              placeholder="Add a note…"
            />
          </Field>

          <div className="rounded-md border border-border bg-surface-2 p-3 text-[12px]">
            <h3 className="mb-2 font-semibold text-ink-2">Details</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-ink-2">
              <dt className="text-ink-3">Account</dt>
              <dd>{accountName}</dd>
              <dt className="text-ink-3">Type</dt>
              <dd>
                {txn.isTransfer
                  ? "Transfer"
                  : txn.amount < 0
                    ? categoryKind(categoryId) === "income" ? "Income" : "Refund / credit"
                    : "Expense"}
              </dd>
              <dt className="text-ink-3">Original description</dt>
              <dd className="break-words font-mono text-[11px]">{txn.rawDescription}</dd>
              <dt className="text-ink-3">Provider category</dt>
              <dd>{txn.providerCategory ?? "—"}</dd>
              <dt className="text-ink-3">Category source</dt>
              <dd className="capitalize">{txn.categorySource}</dd>
              {txn.providerTransactionId && (
                <>
                  <dt className="text-ink-3">Provider ID</dt>
                  <dd className="break-all font-mono text-[11px]">{txn.providerTransactionId}</dd>
                </>
              )}
            </dl>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            disabled={!dirty || saveState.kind === "saving"}
            onClick={() => onSave(txn.id, { merchant, categoryId, notes: notes || null })}
            className={clsx(
              "rounded-md px-4 py-2 text-[13px] font-medium",
              dirty && saveState.kind !== "saving"
                ? "bg-ink text-white"
                : "cursor-default bg-surface-2 text-ink-3",
            )}
          >
            {saveState.kind === "saving" ? "Saving…" : "Save changes"}
          </button>
          {saveState.kind === "saved" && (
            <span className="text-[11px] text-pos">
              Saved
              {saveState.ruleApplied > 1 &&
                ` — rule applied to ${saveState.ruleApplied} matching transactions`}
            </span>
          )}
          {saveState.kind === "error" && (
            <span className="text-[11px] text-neg">
              Could not save — try again.
            </span>
          )}
        </div>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}
