import { NextResponse } from "next/server";
import { PlaidFinancialDataProvider, isPlaidConfigured } from "@/lib/providers/plaid";

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
  } catch {
    return NextResponse.json(
      { error: "Could not create a link token." },
      { status: 502 },
    );
  }
}
