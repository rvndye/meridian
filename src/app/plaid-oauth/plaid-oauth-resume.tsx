"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";
import { Landmark } from "lucide-react";
import {
  clearLinkToken,
  exchangePublicToken,
  readLinkToken,
} from "@/lib/plaid-link-shared";

/** Browser-only state read once after mount (localStorage + URL). */
interface Boot {
  token: string | null;
  uri: string;
  hasOauthState: boolean;
}

type FlowPhase = "resuming" | "exchanging" | "done" | "error";

/**
 * Resumes an OAuth Plaid Link session. Link requires the ORIGINAL link
 * token (from localStorage) plus the full redirect URL the bank sent us
 * back to (window.location.href, which carries Plaid's oauth_state_id).
 */
export function PlaidOauthResume() {
  const router = useRouter();
  const [boot, setBoot] = useState<Boot | null>(null);
  const [flow, setFlow] = useState<{ phase: FlowPhase; message?: string }>({
    phase: "resuming",
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser-only state (localStorage + URL) after mount
    setBoot({
      token: readLinkToken(),
      uri: window.location.href,
      hasOauthState: window.location.search.includes("oauth_state_id"),
    });
  }, []);

  // Boot problems are derived, not set in the effect
  const bootError = !boot
    ? null
    : !boot.hasOauthState
      ? "This page is only used to complete a bank login. Start from the Accounts page."
      : !boot.token
        ? "No connection in progress was found in this browser. Start again from the Accounts page."
        : null;

  const resumable = !!boot && !bootError;

  const onSuccess = useCallback(
    async (publicToken: string | null) => {
      clearLinkToken();
      if (!publicToken) {
        setFlow({
          phase: "error",
          message: "The bank connection was not completed.",
        });
        return;
      }
      setFlow({ phase: "exchanging" });
      try {
        await exchangePublicToken(publicToken);
        setFlow({ phase: "done" });
        router.replace("/accounts");
        router.refresh();
      } catch {
        setFlow({
          phase: "error",
          message: "Saving the connected account failed — try again.",
        });
      }
    },
    [router],
  );

  const { open, ready } = usePlaidLink({
    token: resumable ? boot.token : null,
    receivedRedirectUri: resumable ? boot.uri : undefined,
    onSuccess,
    onExit: (err) => {
      clearLinkToken();
      setFlow({
        phase: "error",
        message:
          err?.display_message ??
          "The connection was cancelled before it finished.",
      });
    },
  });

  // Link re-opens automatically and jumps straight back into the OAuth flow
  useEffect(() => {
    if (resumable && ready && flow.phase === "resuming") open();
  }, [resumable, ready, flow.phase, open]);

  const phase: FlowPhase = bootError ? "error" : flow.phase;
  const message = bootError ?? flow.message;

  return (
    <div className="flex flex-col items-center rounded-lg border border-border bg-surface p-10 text-center">
      <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Landmark size={18} />
      </span>
      {phase === "resuming" && (
        <p className="text-[13px] text-ink-2">
          Completing your bank login securely…
        </p>
      )}
      {phase === "exchanging" && (
        <p className="text-[13px] text-ink-2">
          Bank connected — importing your accounts…
        </p>
      )}
      {phase === "done" && (
        <p className="text-[13px] text-ink-2">Done! Taking you to Accounts…</p>
      )}
      {phase === "error" && (
        <>
          <p className="max-w-md text-[13px] text-ink-2">{message}</p>
          <Link
            href="/accounts"
            className="mt-4 rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-white"
          >
            Back to Accounts
          </Link>
        </>
      )}
    </div>
  );
}
