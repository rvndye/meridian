import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteAsset, updateAsset } from "@/lib/repo";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).nullish(),
  address: z.string().max(300).nullish(),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  purchasePrice: z.number().min(0).max(1e12).nullish(),
  valuationMethod: z.enum(["manual", "automated", "hybrid"]).optional(),
  details: z.record(z.string(), z.unknown()).nullish(),
  liabilityAccountId: z.string().max(64).nullish(),
});

const idOk = (id: string) => /^[\w-]{1,64}$/.test(id);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!idOk(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const asset = await updateAsset(id, parsed.data);
  if (!asset) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ asset });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!idOk(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const ok = await deleteAsset(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
