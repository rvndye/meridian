import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, ensureDbReady, schema } from "@/db/client";
import { encryptSecret } from "@/lib/crypto";
import { PlaidFinancialDataProvider, isPlaidConfigured } from "@/lib/providers/plaid";
import { runSyncAll } from "@/lib/sync";

const bodySchema = z.object({ publicToken: z.string().min(1).max(500) });

export async function POST(req: Request) {
  if (!isPlaidConfigured()) {
    return NextResponse.json({ error: "Plaid is not configured." }, { status: 501 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "publicToken required" }, { status: 400 });
  }
  await ensureDbReady();
  try {
    const provider = new PlaidFinancialDataProvider();
    const result = await provider.connectAccount(parsed.data.publicToken);

    const d = db();
    const institutionId = `inst_${randomUUID()}`;
    await d.insert(schema.institutions).values({
      id: institutionId,
      name: result.institution.name,
      providerInstitutionId: result.institution.providerInstitutionId,
    });
    await d
      .insert(schema.financialConnections)
      .values({
        id: `conn_${randomUUID()}`,
        provider: "plaid",
        providerItemId: result.providerItemId,
        institutionId,
        accessTokenEncrypted: encryptSecret(result.accessToken),
        status: "active",
      })
      .onConflictDoNothing();

    // Initial import happens right away so the dashboard fills in.
    const summaries = await runSyncAll();
    return NextResponse.json({
      ok: true,
      institution: result.institution.name,
      sync: summaries,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to connect the account." },
      { status: 502 },
    );
  }
}
