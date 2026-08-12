"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { X, Plus } from "lucide-react";
import type { Asset, AssetValuation } from "@/lib/domain/types";
import {
  assetEquity,
  effectiveAssetValue,
} from "@/lib/domain/assets";
import { fmtCurrency, fmtCurrencyWhole, fmtDate, fmtPercent } from "@/lib/format";
import { Badge, Card, Delta, StatCard } from "@/components/ui";
import { ValueHistoryChart } from "@/components/charts";

interface LiabilityRef {
  id: string;
  name: string;
  balance: number;
}

const TYPE_LABELS: Record<Asset["assetType"], string> = {
  real_estate: "Real estate",
  vehicle: "Vehicle",
  jewelry: "Jewelry",
  collectible: "Collectible",
  business: "Business",
  cash: "Cash",
  other: "Other",
};

const METHOD_LABELS: Record<Asset["valuationMethod"], string> = {
  manual: "Manual",
  automated: "Automated",
  hybrid: "Hybrid",
};

const inputCls =
  "rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/30";

export function AssetsView({
  assets,
  valuations,
  liabilityAccounts,
}: {
  assets: Asset[];
  valuations: AssetValuation[];
  liabilityAccounts: LiabilityRef[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const valuationsByAsset = useMemo(() => {
    const map = new Map<string, AssetValuation[]>();
    for (const v of valuations) {
      const arr = map.get(v.assetId) ?? [];
      arr.push(v);
      map.set(v.assetId, arr);
    }
    return map;
  }, [valuations]);

  const totals = useMemo(() => {
    let total = 0;
    let earliestTotal = 0;
    const byType = new Map<string, number>();
    for (const a of assets) {
      total += a.currentValue;
      byType.set(a.assetType, (byType.get(a.assetType) ?? 0) + a.currentValue);
      const hist = valuationsByAsset.get(a.id) ?? [];
      earliestTotal += hist[0]?.value ?? a.currentValue;
    }
    return {
      total,
      change: total - earliestTotal,
      realEstate: byType.get("real_estate") ?? 0,
      vehicles: byType.get("vehicle") ?? 0,
      other:
        total - (byType.get("real_estate") ?? 0) - (byType.get("vehicle") ?? 0),
    };
  }, [assets, valuationsByAsset]);

  const selected = assets.find((a) => a.id === selectedId) ?? null;

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total assets"
          value={fmtCurrencyWhole(totals.total)}
          delta={assets.length > 0 ? totals.change : undefined}
          deltaSuffix="since first valuation"
        />
        <StatCard label="Real estate" value={fmtCurrencyWhole(totals.realEstate)} />
        <StatCard label="Vehicles" value={fmtCurrencyWhole(totals.vehicles)} />
        <StatCard label="Other assets" value={fmtCurrencyWhole(totals.other)} />
      </div>

      <Card
        className="mt-4"
        title="Your assets"
        actions={
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-white"
          >
            <Plus size={14} /> Add asset
          </button>
        }
      >
        {assets.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-ink-2">
            No assets yet. Add your home, car, or anything else you own to get a
            complete net-worth picture.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {assets.map((a) => {
              const hist = valuationsByAsset.get(a.id) ?? [];
              const first = hist[0]?.value ?? a.currentValue;
              const share = totals.total > 0 ? a.currentValue / totals.total : 0;
              const lastDate = hist[hist.length - 1]?.valuationDate;
              return (
                <button
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-surface-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium">{a.name}</span>
                      <Badge tone="neutral">{TYPE_LABELS[a.assetType]}</Badge>
                      <Badge tone="accent">{METHOD_LABELS[a.valuationMethod]}</Badge>
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink-3">
                      {fmtPercent(share)} of assets
                      {lastDate && ` · valued ${fmtDate(lastDate)}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="tnum text-[14px] font-semibold">
                      {fmtCurrencyWhole(a.currentValue)}
                    </div>
                    <Delta value={a.currentValue - first} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {showAdd && (
        <AddAssetPanel
          liabilityAccounts={liabilityAccounts}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            router.refresh();
          }}
        />
      )}

      {selected && (
        <AssetDetailPanel
          asset={selected}
          valuations={valuationsByAsset.get(selected.id) ?? []}
          liabilityAccounts={liabilityAccounts}
          onClose={() => setSelectedId(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

// ---------- add asset ----------

function AddAssetPanel({
  liabilityAccounts,
  onClose,
  onSaved,
}: {
  liabilityAccounts: LiabilityRef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    assetType: "real_estate" as Asset["assetType"],
    currentValue: "",
    valuationMethod: "manual" as Asset["valuationMethod"],
    address: "",
    purchaseDate: "",
    purchasePrice: "",
    description: "",
    propertyType: "",
    bedrooms: "",
    bathrooms: "",
    squareFootage: "",
    liabilityAccountId: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isProperty = form.assetType === "real_estate";

  async function save() {
    const value = parseFloat(form.currentValue);
    if (!form.name.trim() || !Number.isFinite(value) || value < 0) {
      setError("A name and a non-negative current value are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const details = isProperty
        ? {
            ...(form.propertyType && { propertyType: form.propertyType }),
            ...(form.bedrooms && { bedrooms: parseFloat(form.bedrooms) }),
            ...(form.bathrooms && { bathrooms: parseFloat(form.bathrooms) }),
            ...(form.squareFootage && {
              squareFootage: parseFloat(form.squareFootage),
            }),
          }
        : undefined;
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          assetType: form.assetType,
          currentValue: value,
          valuationMethod: form.valuationMethod,
          address: form.address.trim() || null,
          purchaseDate: form.purchaseDate || null,
          purchasePrice: form.purchasePrice
            ? parseFloat(form.purchasePrice)
            : null,
          description: form.description.trim() || null,
          details,
          liabilityAccountId: form.liabilityAccountId || null,
        }),
      });
      if (!res.ok) throw new Error();
      onSaved();
    } catch {
      setError("Saving the asset failed — try again.");
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Panel title="Add asset" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <input className={inputCls} value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="Primary Residence" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className={inputCls} value={form.assetType} onChange={(e) => set("assetType")(e.target.value)}>
              {Object.entries(TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="Valuation method">
            <select className={inputCls} value={form.valuationMethod} onChange={(e) => set("valuationMethod")(e.target.value)}>
              <option value="manual">Manual</option>
              <option value="automated">Automated</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </Field>
        </div>
        <Field label="Current value ($)">
          <input className={inputCls} inputMode="decimal" value={form.currentValue} onChange={(e) => set("currentValue")(e.target.value)} placeholder="525000" />
        </Field>
        {(isProperty || form.assetType === "other") && (
          <Field label="Address (optional)">
            <input className={inputCls} value={form.address} onChange={(e) => set("address")(e.target.value)} placeholder="123 Main St, Springfield, IL" />
          </Field>
        )}
        {isProperty && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Property type">
              <input className={inputCls} value={form.propertyType} onChange={(e) => set("propertyType")(e.target.value)} placeholder="Single family" />
            </Field>
            <Field label="Square footage">
              <input className={inputCls} inputMode="numeric" value={form.squareFootage} onChange={(e) => set("squareFootage")(e.target.value)} />
            </Field>
            <Field label="Bedrooms">
              <input className={inputCls} inputMode="numeric" value={form.bedrooms} onChange={(e) => set("bedrooms")(e.target.value)} />
            </Field>
            <Field label="Bathrooms">
              <input className={inputCls} inputMode="decimal" value={form.bathrooms} onChange={(e) => set("bathrooms")(e.target.value)} />
            </Field>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Purchase date (optional)">
            <input type="date" className={inputCls} value={form.purchaseDate} onChange={(e) => set("purchaseDate")(e.target.value)} />
          </Field>
          <Field label="Purchase price (optional)">
            <input className={inputCls} inputMode="decimal" value={form.purchasePrice} onChange={(e) => set("purchasePrice")(e.target.value)} />
          </Field>
        </div>
        {liabilityAccounts.length > 0 && (
          <Field label="Linked loan / mortgage (optional)">
            <select className={inputCls} value={form.liabilityAccountId} onChange={(e) => set("liabilityAccountId")(e.target.value)}>
              <option value="">None</option>
              {liabilityAccounts.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Notes (optional)">
          <textarea rows={2} className={clsx(inputCls, "resize-none")} value={form.description} onChange={(e) => set("description")(e.target.value)} />
        </Field>
        {error && <p className="text-[12px] text-neg">{error}</p>}
        <button
          onClick={save}
          disabled={busy}
          className="mt-1 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60"
        >
          {busy ? "Saving…" : "Add asset"}
        </button>
      </div>
    </Panel>
  );
}

// ---------- asset detail ----------

function AssetDetailPanel({
  asset,
  valuations,
  liabilityAccounts,
  onClose,
  onChanged,
}: {
  asset: Asset;
  valuations: AssetValuation[];
  liabilityAccounts: LiabilityRef[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const effective = effectiveAssetValue(asset, valuations);
  const liability = liabilityAccounts.find((l) => l.id === asset.liabilityAccountId);
  const equity = liability
    ? assetEquity(effective.value, liability.balance)
    : null;

  const [valForm, setValForm] = useState({
    value: "",
    date: new Date().toISOString().slice(0, 10),
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addValuation() {
    const value = parseFloat(valForm.value);
    if (!Number.isFinite(value) || value < 0) {
      setError("Enter a non-negative value.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${asset.id}/valuations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "manual",
          value,
          valuationDate: valForm.date,
          notes: valForm.notes.trim() || null,
        }),
      });
      if (!res.ok) throw new Error();
      setValForm((f) => ({ ...f, value: "", notes: "" }));
      onChanged();
    } catch {
      setError("Saving the valuation failed — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${asset.name}" and its valuation history?`)) return;
    setBusy(true);
    const res = await fetch(`/api/assets/${asset.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      onClose();
      onChanged();
    }
  }

  const history = valuations.map((v) => ({ date: v.valuationDate, value: v.value }));

  return (
    <Panel title={asset.name} onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{TYPE_LABELS[asset.assetType]}</Badge>
        <Badge tone="accent">{METHOD_LABELS[asset.valuationMethod]} valuation</Badge>
        {asset.address && (
          <span className="text-[12px] text-ink-3">{asset.address}</span>
        )}
      </div>

      <div className="mb-4 flex items-baseline gap-3">
        <span className="text-[28px] font-semibold tracking-tight tnum">
          {fmtCurrencyWhole(effective.value)}
        </span>
        {effective.asOf && (
          <span className="text-[12px] text-ink-3">
            as of {fmtDate(effective.asOf)} ({effective.source})
          </span>
        )}
      </div>

      {/* Hybrid: estimate vs override, clearly distinguished */}
      {asset.valuationMethod !== "manual" && (
        <div className="mb-4 rounded-md border border-border bg-surface-2 p-3 text-[12px]">
          <div className="flex flex-col gap-1">
            <span>
              Automated estimate:{" "}
              <span className="tnum font-medium">
                {effective.automated
                  ? fmtCurrencyWhole(effective.automated.value)
                  : "none yet"}
              </span>
              {effective.automated?.valueLow != null &&
                effective.automated?.valueHigh != null && (
                  <span className="text-ink-3">
                    {" "}
                    (est. range {fmtCurrencyWhole(effective.automated.valueLow)}–
                    {fmtCurrencyWhole(effective.automated.valueHigh)})
                  </span>
                )}
            </span>
            {asset.valuationMethod === "hybrid" && (
              <span>
                Your value:{" "}
                <span className="tnum font-medium">
                  {effective.manual
                    ? fmtCurrencyWhole(effective.manual.value)
                    : "none — estimate is used"}
                </span>
              </span>
            )}
            <span className="text-ink-3">
              Estimates are approximations, not guaranteed market values. Net
              worth uses{" "}
              <span className="font-medium text-ink-2">
                {fmtCurrencyWhole(effective.value)}
              </span>
              .
            </span>
          </div>
        </div>
      )}

      {equity && (
        <div className="mb-4 rounded-md border border-border bg-surface-2 p-3 text-[12px]">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="text-ink-3">Market value</div>
              <div className="tnum font-semibold">{fmtCurrencyWhole(effective.value)}</div>
            </div>
            <div>
              <div className="text-ink-3">{liability!.name}</div>
              <div className="tnum font-semibold">
                −{fmtCurrencyWhole(equity.liabilityBalance)}
              </div>
            </div>
            <div>
              <div className="text-ink-3">Equity</div>
              <div className="tnum font-semibold">{fmtCurrencyWhole(equity.equity)}</div>
            </div>
          </div>
        </div>
      )}

      {history.length > 1 && (
        <div className="mb-4">
          <h3 className="mb-2 text-[12px] font-semibold text-ink-2">
            Value history
          </h3>
          <ValueHistoryChart data={history} />
        </div>
      )}

      <h3 className="mb-2 text-[12px] font-semibold text-ink-2">Valuations</h3>
      <div className="mb-4 divide-y divide-border rounded-md border border-border">
        {[...valuations].reverse().map((v) => (
          <div key={v.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
            <span className="tnum w-24 text-ink-2">{fmtDate(v.valuationDate)}</span>
            <span className="tnum font-medium">{fmtCurrency(v.value)}</span>
            <Badge tone={v.source === "manual" ? "neutral" : "accent"}>
              {v.source}
            </Badge>
            {v.notes && <span className="truncate text-[12px] text-ink-3">{v.notes}</span>}
          </div>
        ))}
      </div>

      <h3 className="mb-2 text-[12px] font-semibold text-ink-2">
        Add manual valuation
      </h3>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Value ($)">
          <input className={clsx(inputCls, "w-32")} inputMode="decimal" value={valForm.value} onChange={(e) => setValForm((f) => ({ ...f, value: e.target.value }))} />
        </Field>
        <Field label="Date">
          <input type="date" className={inputCls} value={valForm.date} onChange={(e) => setValForm((f) => ({ ...f, date: e.target.value }))} />
        </Field>
        <Field label="Notes">
          <input className={clsx(inputCls, "w-44")} value={valForm.notes} onChange={(e) => setValForm((f) => ({ ...f, notes: e.target.value }))} />
        </Field>
        <button
          onClick={addValuation}
          disabled={busy}
          className="rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-60"
        >
          Save
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] text-neg">{error}</p>}

      <div className="mt-6 border-t border-border pt-3">
        <button
          onClick={remove}
          disabled={busy}
          className="text-[12px] font-medium text-neg hover:underline"
        >
          Delete asset
        </button>
      </div>
    </Panel>
  );
}

// ---------- shared panel scaffolding ----------

function Panel({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/20" onClick={onClose} />
      <aside
        className={clsx(
          "absolute inset-y-0 right-0 flex w-full flex-col overflow-y-auto border-l border-border bg-surface p-6 shadow-xl",
          wide ? "max-w-xl" : "max-w-md",
        )}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}
