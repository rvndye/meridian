import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authEnabled,
  getSession,
  loginAllowed,
  recordLoginAttempt,
  verifyPassword,
} from "@/lib/auth";

const bodySchema = z.object({ password: z.string().min(1).max(500) });

export async function POST(req: Request) {
  if (!authEnabled()) {
    return NextResponse.json({ error: "auth disabled" }, { status: 400 });
  }
  if (!loginAllowed()) {
    return NextResponse.json(
      { error: "Too many attempts — wait 15 minutes." },
      { status: 429 },
    );
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "password required" }, { status: 400 });
  }
  recordLoginAttempt();
  if (!verifyPassword(parsed.data.password)) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }
  const session = await getSession();
  session.authenticated = true;
  await session.save();
  return NextResponse.json({ ok: true });
}
