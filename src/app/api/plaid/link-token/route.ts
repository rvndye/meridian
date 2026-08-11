import { NextResponse } from "next/server";
import { PlaidFinancialDataProvider, isPlaidConfigured } from "@/lib/providers/plaid";

interface PlaidErrorShape {
  error_type?: string;
  error_code?: string;
  error_message?: string;
}

export async function POST() {
  if (!isPlaidConfigured()) {
    return NextResponse.json(
      { error: "Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET." },
      { status: 501 },
    );
  }
  try {
    const provider = new PlaidFinancialDataProvider();
    const { linkToken } = await provider.createLinkToken();
    return NextResponse.json({ linkToken });
  } catch (err) {
    const data: PlaidErrorShape =
      (err as { response?: { data?: PlaidErrorShape } })?.response?.data ?? {};
    // Codes only — never tokens, secrets, or full payloads.
    console.error("plaid link_token_create failed", {
      error_type: data.error_type,
      error_code: data.error_code,
    });
    const redirectIssue =
      data.error_code === "INVALID_FIELD" &&
      /redirect/i.test(data.error_message ?? "");
    return NextResponse.json(
      {
        error: redirectIssue
          ? "Plaid rejected the OAuth redirect URI. The exact value of PLAID_REDIRECT_URI must be listed under Allowed redirect URIs in the Plaid dashboard."
          : "Could not create a link token.",
      },
      { status: 502 },
    );
  }
}
