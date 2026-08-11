"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";
import clsx from "clsx";
import {
  clearLinkToken,
  exchangePublicToken,
  storeLinkToken,
} from "@/lib/plaid-link-shared";

/**
 * "Connect account" via the provider's secure widget (Plaid Link).
 * Bank credentials are entered only inside Plaid's UI — this app never
 * sees them; we receive a short-lived public token to exchange server-side.
 *
 * OAuth institutions redirect to the bank and back to /plaid-oauth; the
 * link token is stashed in localStorage so that page can resume the flow.
 */
export function ConnectAccountButton({
  configured,
}: {
  configured: boolean;
}) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSuccess = useCallback(
    async (publicToken: string | null) => {
      clearLinkToken();
      if (!publicToken) return;
      setBusy(true);
      try {
        await exchangePublicToken(publicToken);
        router.refresh();
      } catch {
        setError("Connecting the account failed — try again.");
      } finally {
        setBusy(false);
        setLinkToken(null);
      }
    },
    [router],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => {
      clearLinkToken();
      setLinkToken(null);
    },
  });

  async function begin() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/plaid/link-token", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "link token failed");
      // Persist before opening: an OAuth bank will navigate away from this
      // page, and /plaid-oauth needs the same token to resume.
      storeLinkToken(data.linkToken);
      setLinkToken(data.linkToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start Plaid Link.");
    } finally {
      setBusy(false);
    }
  }

  // Open Link as soon as the token arrives and the widget is ready
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  if (!configured) {
    return (
      <span
        className="cursor-not-allowed rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-white opacity-50"
        title="Set PLAID_CLIENT_ID and PLAID_SECRET to enable bank connections"
      >
        + Connect account
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-[12px] text-neg">{error}</span>}
      <button
        onClick={begin}
        disabled={busy}
        className={clsx(
          "rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-white",
          busy && "opacity-60",
        )}
      >
        {busy ? "Opening…" : "+ Connect account"}
      </button>
    </span>
  );
}
