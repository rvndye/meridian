"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm({ next = "/" }: { next?: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Login failed.");
        return;
      }
      router.push(next);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Passphrase"
        autoComplete="current-password"
        className="rounded-md border border-border bg-surface px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
      {error && <p className="text-[12px] text-neg">{error}</p>}
      <button
        type="submit"
        disabled={busy || password.length === 0}
        className="rounded-md bg-ink px-4 py-2 text-[14px] font-medium text-white disabled:opacity-50"
      >
        {busy ? "Unlocking…" : "Unlock"}
      </button>
    </form>
  );
}
