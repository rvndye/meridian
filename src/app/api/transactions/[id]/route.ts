import { NextResponse } from "next/server";
import { z } from "zod";
import { updateTransaction } from "@/lib/repo";
import { CATEGORY_BY_ID } from "@/lib/domain/categories";

const patchSchema = z.object({
  merchant: z.string().trim().min(1).max(200).optional(),
  categoryId: z
    .string()
    .refine((id) => CATEGORY_BY_ID.has(id), "unknown category")
    .optional(),
  notes: z.string().max(2000).nullable().optional(),
  createRule: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { createRule, ...patch } = parsed.data;
  const result = await updateTransaction(id, patch, { createRule });
  if (!result) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
