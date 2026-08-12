import { NextResponse } from "next/server";
import {
  MAX_UPLOAD_BYTES,
  findStatementImport,
  markDuplicates,
  parseUpload,
} from "@/lib/imports/apple-card-service";

// PDF text extraction on a large statement can take a moment.
export const maxDuration = 60;

/**
 * Preview an Apple Card statement upload. Parses in memory, never stores or
 * logs the document; returns the normalized rows for user confirmation.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const accountId = form?.get("accountId");
  if (!(file instanceof File) || typeof accountId !== "string") {
    return NextResponse.json(
      { error: "Expected multipart form with 'file' and 'accountId'." },
      { status: 400 },
    );
  }
  if (!/^[\w-]{1,64}$/.test(accountId)) {
    return NextResponse.json({ error: "invalid account" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File is larger than 10 MB." }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const parsed = await parseUpload(file.name, bytes);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 422 });
  }

  const [duplicates, priorImport] = await Promise.all([
    markDuplicates(accountId, parsed.statement),
    findStatementImport(accountId, parsed.fileHash),
  ]);

  return NextResponse.json({
    source: parsed.source,
    fileHash: parsed.fileHash,
    alreadyImported: !!priorImport,
    statement: {
      periodStart: parsed.statement.periodStart,
      periodEnd: parsed.statement.periodEnd,
      statementBalance:
        parsed.statement.statementBalanceCents !== null
          ? parsed.statement.statementBalanceCents / 100
          : null,
      uncertainCount: parsed.statement.uncertainCount,
    },
    statementBalanceCents: parsed.statement.statementBalanceCents,
    rows: parsed.statement.rows.map((r, i) => ({
      index: i,
      date: r.date,
      postedDate: r.postedDate,
      merchant: r.merchant,
      description: r.description,
      amount: r.amountCents / 100,
      amountCents: r.amountCents,
      type: r.type,
      appleCategory: r.appleCategory,
      duplicate: duplicates[i],
    })),
  });
}
