/**
 * Demo seeding: on first run (empty database) insert the deterministic fake
 * dataset so the app works before any real accounts are connected.
 * Disable with DEMO_DATA=false. Clearing: `npm run db:reset`.
 */
import { randomUUID } from "node:crypto";
import { db, schema } from "./client";
import { generateMockData } from "../lib/mock/generate";
import { detectRecurring } from "../lib/domain/analytics";

export const cents = (n: number) => Math.round(n * 100);

export async function seedDemoIfEmpty(): Promise<void> {
  if (process.env.DEMO_DATA === "false") return;
  const d = db();
  const existing = await d.select().from(schema.accounts).limit(1);
  if (existing.length > 0) return;
  await seedDemo();
}

export async function seedDemo(): Promise<void> {
  const d = db();
  const today = new Date().toISOString().slice(0, 10);
  const data = generateMockData(today);
  const now = new Date();

  const institutionNames = [
    ...new Set(data.accounts.map((a) => a.institutionName)),
  ];
  const instIds = new Map<string, string>();
  for (const name of institutionNames) {
    const id = `inst_demo_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    instIds.set(name, id);
    await d
      .insert(schema.institutions)
      .values({ id, name, providerInstitutionId: null })
      .onConflictDoNothing();
  }

  const connectionId = "conn_demo";
  await d
    .insert(schema.financialConnections)
    .values({
      id: connectionId,
      provider: "demo",
      providerItemId: "demo",
      institutionId: null,
      accessTokenEncrypted: null,
      status: "active",
      lastSyncedAt: now,
    })
    .onConflictDoNothing();

  await d.insert(schema.accounts).values(
    data.accounts.map((a) => ({
      id: a.id,
      connectionId,
      providerAccountId: a.id,
      institutionName: a.institutionName,
      name: a.name,
      officialName: a.officialName,
      type: a.type,
      mask: a.mask,
      currentBalanceCents: cents(a.currentBalance),
      availableBalanceCents:
        a.availableBalance !== null ? cents(a.availableBalance) : null,
      creditLimitCents: a.creditLimit !== null ? cents(a.creditLimit) : null,
      currency: a.currency,
      status: a.status,
      lastSyncedAt: a.lastSyncedAt ? new Date(a.lastSyncedAt) : null,
    })),
  );

  // Insert in chunks to stay under parameter limits
  const txRows = data.transactions.map((t) => ({
    id: t.id,
    accountId: t.accountId,
    providerTransactionId: t.providerTransactionId,
    date: t.date,
    merchant: t.merchant,
    rawDescription: t.rawDescription,
    amountCents: cents(t.amount),
    currency: t.currency,
    status: t.status,
    categoryId: t.categoryId,
    categorySource: t.categorySource,
    providerCategory: t.providerCategory,
    providerData: { demo: true, providerCategory: t.providerCategory },
    isTransfer: t.isTransfer,
    transferPairId: t.transferPairId,
    notes: t.notes,
  }));
  for (let i = 0; i < txRows.length; i += 200) {
    await d.insert(schema.transactions).values(txRows.slice(i, i + 200));
  }

  const snapRows = data.snapshots.map((s) => ({
    id: randomUUID(),
    accountId: s.accountId,
    date: s.date,
    balanceCents: cents(s.balance),
  }));
  for (let i = 0; i < snapRows.length; i += 500) {
    await d.insert(schema.balanceSnapshots).values(snapRows.slice(i, i + 500));
  }

  const recurring = detectRecurring(data.transactions, today);
  if (recurring.length > 0) {
    await d.insert(schema.recurringTransactions).values(
      recurring.map((r) => ({
        id: r.id,
        merchant: r.merchant,
        categoryId: r.categoryId,
        accountId: r.accountId,
        cadence: r.cadence,
        typicalAmountCents: cents(r.typicalAmount),
        lastDate: r.lastDate,
        nextExpectedDate: r.nextExpectedDate,
        annualizedCostCents: cents(r.annualizedCost),
        occurrences: r.occurrences,
        active: r.active,
      })),
    );
  }

  await d.insert(schema.syncEvents).values({
    id: randomUUID(),
    connectionId,
    startedAt: now,
    finishedAt: now,
    status: "success",
    added: txRows.length,
    modified: 0,
    removed: 0,
    message: "Demo dataset seeded",
  });
}
