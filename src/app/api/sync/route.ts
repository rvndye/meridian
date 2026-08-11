import { NextResponse } from "next/server";
import { getSyncEvents, getLastSyncedAt } from "@/lib/repo";
import { runSyncAll } from "@/lib/sync";

export async function GET() {
  const [events, lastSyncedAt] = await Promise.all([
    getSyncEvents(20),
    getLastSyncedAt(),
  ]);
  return NextResponse.json({ lastSyncedAt, events });
}

export async function POST() {
  const results = await runSyncAll();
  return NextResponse.json({ results });
}
