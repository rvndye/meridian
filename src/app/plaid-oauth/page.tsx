import { PageHeader } from "@/components/ui";
import { PlaidOauthResume } from "./plaid-oauth-resume";

export const dynamic = "force-dynamic";

/**
 * OAuth return page. Plaid redirects here after the user authenticates at
 * their bank; the client component re-initializes Link with the stored
 * link token and the received redirect URI to finish the connection.
 * This route path must match PLAID_REDIRECT_URI.
 */
export default function PlaidOauthPage() {
  return (
    <>
      <PageHeader title="Finishing bank connection" />
      <PlaidOauthResume />
    </>
  );
}
