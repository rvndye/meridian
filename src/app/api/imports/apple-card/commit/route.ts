import { NextResponse } from "next/server";
import { z } from "zod";
import { commitImport } from "@/lib/imports/apple-card-service";
import type { ParsedStatement } from "@/lib/imports/apple-card";

export const maxDuration = 60;

const rowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  postedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  description: z.string().min(1).max(300),
  merchant: z.string().min(1).max(200),
  amountCents: z.number().int().min(-1e10).max(1e10),
  type: z.enum(["purchase", "payment", "credit", "interest", "fee"]),
  appleCategory: z.string().max(60).nullable(),
});

const bodySchema = z.object({
  accountId: z.string().regex(/^[\w-]{1,64}$/),
  source: z.enum(["apple_card_pdf", "apple_card_csv"]),
  fileHash: z.string().regex(/^[0-9a-f]{64}$/),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  statementBalanceCents: z.number().int().nullable(),
  uncertainCount: z.number().int().min(0),
  rows: z.array(rowSchema).min(1).max(5000),
  /** Indexes into `rows` to import; empty/omitted = all. */
  selected: z.array(z.number().int().min(0)).optional(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const b = parsed.data;
  const statement: ParsedStatement = {
    rows: b.rows,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    statementBalanceCents: b.statementBalanceCents,
    uncertainCount: b.uncertainCount,
  };
  try {
    const summary = await commitImport(
      b.accountId,
      b.source,
      b.fileHash,
      statement,
      b.selected,
    );
    return NextResponse.json(summary);
  } catch {
    // No statement contents in errors or logs.
    return NextResponse.json(
      { error: "Import failed — no transactions were saved." },
      { status: 500 },
    );
  }
}
