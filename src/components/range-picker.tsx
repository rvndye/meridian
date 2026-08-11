"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";

const OPTIONS = [
  { key: "1m", label: "1M" },
  { key: "3m", label: "3M" },
  { key: "6m", label: "6M" },
  { key: "12m", label: "12M" },
];

export function RangePicker({ defaultKey = "1m" }: { defaultKey?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const active = params.get("range") ?? defaultKey;
  const [showCustom, setShowCustom] = useState(active === "custom");
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");

  function go(key: string) {
    const q = new URLSearchParams(params.toString());
    q.set("range", key);
    q.delete("from");
    q.delete("to");
    router.push(`${pathname}?${q.toString()}`);
    setShowCustom(false);
  }

  function goCustom() {
    if (!from || !to) return;
    const q = new URLSearchParams(params.toString());
    q.set("range", "custom");
    q.set("from", from);
    q.set("to", to);
    router.push(`${pathname}?${q.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-md border border-border bg-surface p-0.5">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            onClick={() => go(o.key)}
            className={clsx(
              "rounded px-2.5 py-1 text-[12px] font-medium transition-colors",
              active === o.key
                ? "bg-ink text-white"
                : "text-ink-2 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        ))}
        <button
          onClick={() => setShowCustom((v) => !v)}
          className={clsx(
            "rounded px-2.5 py-1 text-[12px] font-medium transition-colors",
            active === "custom" ? "bg-ink text-white" : "text-ink-2 hover:text-ink",
          )}
        >
          Custom
        </button>
      </div>
      {showCustom && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-[12px]"
          />
          <span className="text-[12px] text-ink-3">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-[12px]"
          />
          <button
            onClick={goCustom}
            className="rounded-md bg-ink px-2.5 py-1 text-[12px] font-medium text-white"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
