"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import type { CategoryRule } from "@/lib/domain/types";
import { categoryName } from "@/lib/domain/categories";

export function RulesList({ rules }: { rules: CategoryRule[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function remove(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/rules/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (rules.length === 0) {
    return (
      <p className="text-[13px] text-ink-2">
        No rules yet. Change a transaction&apos;s category from the
        transactions page and a merchant rule is created automatically.
      </p>
    );
  }

  return (
    <div className="divide-y divide-border">
      {rules.map((r) => (
        <div key={r.id} className="flex items-center gap-3 py-2.5 text-[13px]">
          <span className="font-medium">&ldquo;{r.merchantPattern}&rdquo;</span>
          <span className="text-ink-3">→</span>
          <span>{categoryName(r.categoryId)}</span>
          <button
            onClick={() => remove(r.id)}
            disabled={busyId === r.id}
            aria-label={`Delete rule for ${r.merchantPattern}`}
            className="ml-auto rounded-md p-1.5 text-ink-3 hover:bg-surface-2 hover:text-neg"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
