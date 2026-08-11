/**
 * Client-side pieces shared between the "Connect account" button and the
 * OAuth return page (/plaid-oauth).
 *
 * OAuth institutions leave the app for the bank's own login page, so the
 * in-flight link token is kept in localStorage: the return page must
 * re-initialize Plaid Link with the SAME token plus the redirect URL.
 * The token is short-lived (~4h), single-purpose, and grants no account
 * access by itself — safe to keep in localStorage per Plaid's OAuth guide.
 */

export const PLAID_LINK_TOKEN_KEY = "meridian.plaid_link_token";

export function storeLinkToken(token: string): void {
  try {
    localStorage.setItem(PLAID_LINK_TOKEN_KEY, token);
  } catch {
    // storage unavailable (private mode) — OAuth banks won't resume, but
    // non-OAuth institutions still work
  }
}

export function readLinkToken(): string | null {
  try {
    return localStorage.getItem(PLAID_LINK_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearLinkToken(): void {
  try {
    localStorage.removeItem(PLAID_LINK_TOKEN_KEY);
  } catch {
    // ignore
  }
}

/** Exchange the public token server-side; resolves when accounts are saved. */
export async function exchangePublicToken(publicToken: string): Promise<void> {
  const res = await fetch("/api/plaid/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicToken }),
  });
  if (!res.ok) {
    throw new Error("exchange failed");
  }
}
