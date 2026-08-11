/**
 * Database integration tests against an isolated PGlite instance:
 * sync dedup, pending→posted replacement, user overrides, merchant rules.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProviderTransaction } from "../src/lib/providers/types";

const dataDir = mkdtempSync(path.join(tmpdir(), "meridian-test-"));
process.env.PGLITE_DIR = path.join(dataDir, "pglite");
process.env.DEMO_DATA = "false";
delete process.env.DATABASE_URL;

// import after env is set so the client opens the temp database
const clientMod = await import("../src/db/client");
const repo = await import("../src/lib/repo");
const sync = await import("../src/lib/sync");
const { db, ensureDbReady, schema } = clientMod;

const accountMap = new Map([["prov_acct_1", "acc_test"]]);

function pt(overrides: Partial<ProviderTransaction>): ProviderTransaction {
  return {
    providerTransactionId: "ptx_1",
    providerAccountId: "prov_acct_1",
    date: "2026-07-10",
    merchant: "Blue Bottle Coffee",
    rawDescription: "BLUE BOTTLE COFFEE",
    amount: 6.5,
    currency: "USD",
    pending: false,
    pendingProviderTransactionId: null,
    providerCategoryPrimary: "FOOD_AND_DRINK",
    providerCategoryDetailed: null,
    raw: { test: true },
    ...overrides,
  };
}

beforeAll(async () => {
  await ensureDbReady();
  await db().insert(schema.accounts).values({
    id: "acc_test",
    connectionId: null,
    providerAccountId: "prov_acct_1",
    institutionName: "Test Bank",
    name: "Test Checking",
    type: "checking",
    mask: "1111",
    currentBalanceCents: 100000,
    currency: "USD",
    status: "active",
  });
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("sync ingestion", () => {
  it("categorizes from the provider category on insert", async () => {
    const r = await sync.ingestTransaction(pt({}), accountMap, []);
    expect(r).toBe("added");
    const txns = await repo.getTransactions();
    const t = txns.find((x) => x.providerTransactionId === "ptx_1");
    expect(t?.categoryId).toBe("restaurants");
    expect(t?.categorySource).toBe("provider");
    expect(t?.amount).toBe(6.5);
  });

  it("does not duplicate when the same provider transaction syncs again", async () => {
    const r = await sync.ingestTransaction(pt({}), accountMap, []);
    expect(r).toBe("modified");
    const txns = await repo.getTransactions();
    expect(
      txns.filter((x) => x.providerTransactionId === "ptx_1"),
    ).toHaveLength(1);
  });

  it("replaces a pending transaction in place when it posts", async () => {
    await sync.ingestTransaction(
      pt({
        providerTransactionId: "ptx_pending",
        pending: true,
        amount: 20,
        date: "2026-07-11",
        merchant: "Gas Station",
        rawDescription: "GAS STATION AUTH",
      }),
      accountMap,
      [],
    );
    const before = await repo.getTransactions();
    const pendingRow = before.find(
      (x) => x.providerTransactionId === "ptx_pending",
    );
    expect(pendingRow?.status).toBe("pending");

    // posted form arrives with a new ID referencing the pending one
    const r = await sync.ingestTransaction(
      pt({
        providerTransactionId: "ptx_posted",
        pendingProviderTransactionId: "ptx_pending",
        pending: false,
        amount: 21.37,
        date: "2026-07-12",
        merchant: "Gas Station",
        rawDescription: "GAS STATION",
      }),
      accountMap,
      [],
    );
    expect(r).toBe("modified");

    const after = await repo.getTransactions();
    const gas = after.filter((x) => x.merchant === "Gas Station");
    expect(gas).toHaveLength(1); // replaced, not duplicated
    expect(gas[0].id).toBe(pendingRow!.id); // same row
    expect(gas[0].status).toBe("posted");
    expect(gas[0].amount).toBe(21.37);
    expect(gas[0].providerTransactionId).toBe("ptx_posted");
  });

  it("preserves user category edits across provider updates", async () => {
    await repo.updateTransaction(
      (await repo.getTransactions()).find(
        (x) => x.providerTransactionId === "ptx_1",
      )!.id,
      { categoryId: "personal" },
      { createRule: false },
    );
    await sync.ingestTransaction(pt({ amount: 7.0 }), accountMap, []);
    const t = (await repo.getTransactions()).find(
      (x) => x.providerTransactionId === "ptx_1",
    );
    expect(t?.amount).toBe(7.0); // provider fields updated
    expect(t?.categoryId).toBe("personal"); // user override preserved
    expect(t?.categorySource).toBe("user");
  });
});

describe("category rules", () => {
  it("applies a new rule retroactively but never over user overrides", async () => {
    await sync.ingestTransaction(
      pt({
        providerTransactionId: "ptx_sbux",
        merchant: "Starbucks",
        rawDescription: "STARBUCKS STORE 123",
        amount: 5.75,
        date: "2026-07-13",
      }),
      accountMap,
      [],
    );
    const applied = await repo.upsertRuleAndApply("Starbucks", "personal");
    expect(applied).toBe(1);
    const txns = await repo.getTransactions();
    expect(
      txns.find((x) => x.providerTransactionId === "ptx_sbux")?.categoryId,
    ).toBe("personal");
    // ptx_1 carries a user override; the rule must not have touched it
    expect(
      txns.find((x) => x.providerTransactionId === "ptx_1")?.categorySource,
    ).toBe("user");
  });

  it("categorizes future syncs via the rule", async () => {
    const rules = await db().select().from(schema.categoryRules);
    await sync.ingestTransaction(
      pt({
        providerTransactionId: "ptx_sbux2",
        merchant: "Starbucks",
        rawDescription: "STARBUCKS STORE 456",
        amount: 4.25,
        date: "2026-07-14",
      }),
      accountMap,
      rules,
    );
    const t = (await repo.getTransactions()).find(
      (x) => x.providerTransactionId === "ptx_sbux2",
    );
    expect(t?.categoryId).toBe("personal");
    expect(t?.categorySource).toBe("rule");
  });

  it("updating a transaction with createRule makes a rule for the merchant", async () => {
    const target = (await repo.getTransactions()).find(
      (x) => x.providerTransactionId === "ptx_sbux2",
    )!;
    const result = await repo.updateTransaction(target.id, {
      categoryId: "restaurants",
    });
    expect(result?.transaction.categoryId).toBe("restaurants");
    const rules = await repo.getCategoryRules();
    const rule = rules.find((r) => r.merchantPattern === "Starbucks");
    expect(rule?.categoryId).toBe("restaurants");
  });
});
