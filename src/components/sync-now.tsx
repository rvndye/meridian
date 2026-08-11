"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import clsx from "clsx";

export function SyncNowButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function sync() {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={sync}
      disabled={busy}
      className={clsx(
        "flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] font-medium",
        error ? "text-neg" : "text-ink-2 hover:text-ink",
      )}
    >
      <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
      {busy ? "Syncing…" : error ? "Sync failed — retry" : "Sync now"}
    </button>
  );
}
