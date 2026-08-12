import { NextResponse } from "next/server";
import { z } from "zod";
import { createAppleCardAccount } from "@/lib/imports/apple-card-service";

const bodySchema = z.object({
  name: z.string().trim().max(80).optional(),
  mask: z
    .string()
    .regex(/^\d{4}$/)
    .nullish(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const account = await createAppleCardAccount(parsed.data);
  return NextResponse.json({ account }, { status: 201 });
}
