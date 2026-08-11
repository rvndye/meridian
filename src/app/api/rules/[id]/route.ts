import { NextResponse } from "next/server";
import { deleteCategoryRule } from "@/lib/repo";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[\w-]{1,80}$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await deleteCategoryRule(id);
  return NextResponse.json({ ok: true });
}
