/**
 * Integration tests on an isolated PGlite database: Apple Card import
 * end-to-end (dedup, payments, rules, categorization) and asset persistence
 * (valuation history, method changes, net-worth inputs). Fake data only.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "meridian-import-test-"));
process.env.PGLITE_DIR = path.join(dataDir, "pglite");
process.env.DEMO_DATA = "false";
delete process.env.DATABASE_URL;
delete process.env.VERCEL;

const clientMod = await import("../src/db/client");
const repo = await import("../src/lib/repo");
const service = await import("../src/lib/imports/apple-card-service");
const { parseAppleCardCsv } = await import("../src/lib/imports/apple-card");
const { db, ensureDbReady, schema } = clientMod;

const CSV = `Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By
08/01/2026,08/02/2026,APPLE.COM/BILL,Apple,Shopping,Purchase,49.99,Test User
08/03/2026,08/04/2026,WHOLE FOODS MARKET,Whole Foods,Grocery,Purchase,84.21,Test User
08/05/2026,08/05/2026,ACH DEPOSIT INTERNET PAYMENT,Apple Card Payment,Other,Payment,-1500.00,Test User
08/07/2026,08/08/2026,STARBUCKS COFFEE,Starbucks,Restaurants,Purchase,7.25,Test User
08/09/2026,08/10/2026,NIKE RETURN,Nike,Shopping,Credit,-62.50,Test User`;

let accountId: string;

beforeAll(async () => {
  await ensureDbReady();
  const created = await service.createAppleCardAccount({
    name: "Apple Card",
    mask: "0001",
  });
  accountId = created.id;
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function statement() {
  return parseAppleCardCsv(CSV);
}

describe("Apple Card import", () => {
  it("creates a clearly identified manual Apple Card account", async () => {
    const accounts = await repo.getAccounts();
    const apple = accounts.find((a) => a.id === accountId)!;
    expect(apple.institutionName).toBe("Apple Card");
    expect(apple.type).toBe("credit_card");
  });

  it("imports all rows through the standard ingestion path", async () => {
    const summary = await service.commitImport(
      accountId,
      "apple_card_csv",
      "a".repeat(64),
      statement(),
    );
    expect(summary.added).toBe(5);
    const txns = (await repo.getTransactions()).filter(
      (t) => t.accountId === accountId,
    );
    expect(txns).toHaveLength(5);
  });

  it("re-importing the same statement creates no duplicates", async () => {
    const summary = await service.commitImport(
      accountId,
      "apple_card_csv",
      "a".repeat(64),
      statement(),
    );
    expect(summary.added).toBe(0);
    expect(summary.duplicates).toBe(5);
    const txns = (await repo.getTransactions()).filter(
      (t) => t.accountId === accountId,
    );
    expect(txns).toHaveLength(5);
  });

  it("classifies the card payment so it is never income or spending", async () => {
    const txns = (await repo.getTransactions()).filter(
      (t) => t.accountId === accountId,
    );
    const payment = txns.find((t) => t.amount === -1500)!;
    expect(payment.categoryId).toBe("credit_card_payment");
    const { isIncome, isSpending } = await import(
      "../src/lib/domain/analytics"
    );
    expect(isIncome(payment)).toBe(false);
    expect(isSpending(payment)).toBe(false);
  });

  it("maps Apple categories through the normal categorization", async () => {
    const txns = (await repo.getTransactions()).filter(
      (t) => t.accountId === accountId,
    );
    expect(txns.find((t) => t.merchant === "Whole Foods")!.categoryId).toBe(
      "groceries",
    );
    expect(txns.find((t) => t.merchant === "Apple")!.categoryId).toBe(
      "shopping",
    );
  });

  it("treats refunds as negative amounts in an expense category", async () => {
    const txns = (await repo.getTransactions()).filter(
      (t) => t.accountId === accountId,
    );
    const refund = txns.find((t) => t.merchant === "Nike")!;
    expect(refund.amount).toBe(-62.5);
    expect(refund.categoryId).toBe("shopping");
    const { totalsForRange } = await import("../src/lib/domain/analytics");
    const totals = totalsForRange(txns, "2026-08-01", "2026-08-31");
    // refund nets against spending; payment excluded entirely
    expect(totals.spending).toBeCloseTo(49.99 + 84.21 + 7.25 - 62.5);
    expect(totals.income).toBe(0);
  });

  it("merchant rules apply to imported transactions", async () => {
    await repo.upsertRuleAndApply("Starbucks", "personal");
    const txns = (await repo.getTransactions()).filter(
      (t) => t.accountId === accountId,
    );
    expect(txns.find((t) => t.merchant === "Starbucks")!.categoryId).toBe(
      "personal",
    );
  });

  it("records the statement import for file-level dedup", async () => {
    const found = await service.findStatementImport(accountId, "a".repeat(64));
    expect(found).not.toBeNull();
    expect(found!.importedCount).toBe(0); // second commit imported nothing new
  });

  it("rejects imports into non-Apple-Card accounts", async () => {
    await db().insert(schema.accounts).values({
      id: "acc_other",
      institutionName: "Chase",
      name: "Checking",
      type: "checking",
      currentBalanceCents: 0,
      currency: "USD",
      status: "active",
    });
    await expect(
      service.commitImport("acc_other", "apple_card_csv", "b".repeat(64), statement()),
    ).rejects.toThrow(/not an apple card/i);
  });
});

describe("assets persistence", () => {
  let assetId: string;

  it("creates an asset with an initial manual valuation", async () => {
    const asset = await repo.createAsset({
      name: "Test House",
      assetType: "real_estate",
      valuationMethod: "hybrid",
      currentValue: 490000,
      valuationDate: "2025-08-01",
      address: "1 Test Lane",
      purchasePrice: 450000,
      purchaseDate: "2024-06-01",
      details: { propertyType: "Single family", bedrooms: 3 },
    });
    assetId = asset.id;
    expect(asset.currentValue).toBe(490000);
    const history = await repo.getAssetValuations(assetId);
    expect(history).toHaveLength(1);
    expect(history[0].source).toBe("manual");
  });

  it("adds valuations as history, never overwriting", async () => {
    await repo.addAssetValuation(assetId, {
      valuationDate: "2026-01-15",
      value: 505000,
      source: "manual",
    });
    await repo.addAssetValuation(assetId, {
      valuationDate: "2026-08-01",
      value: 512400,
      source: "automated",
      valueLow: 480000,
      valueHigh: 548000,
    });
    await repo.addAssetValuation(assetId, {
      valuationDate: "2026-08-12",
      value: 525000,
      source: "manual",
    });
    const history = await repo.getAssetValuations(assetId);
    expect(history).toHaveLength(4);
    expect(history.map((v) => v.value)).toEqual([
      490000, 505000, 512400, 525000,
    ]);
  });

  it("hybrid method: manual override wins for the stored current value", async () => {
    const asset = (await repo.getAsset(assetId))!;
    expect(asset.currentValue).toBe(525000); // manual 525k beats automated 512.4k
  });

  it("switching to automated recomputes the effective value", async () => {
    const updated = await repo.updateAsset(assetId, {
      valuationMethod: "automated",
    });
    expect(updated!.currentValue).toBe(512400);
    await repo.updateAsset(assetId, { valuationMethod: "hybrid" });
  });

  it("asset appreciation and net worth integration use the same data", async () => {
    const [accounts, assets] = await Promise.all([
      repo.getAccounts(),
      repo.getAssets(),
    ]);
    const { netWorthBreakdown } = await import("../src/lib/domain/assets");
    const withValues = assets.map((asset) => ({
      asset,
      value: asset.currentValue,
    }));
    const b = netWorthBreakdown(accounts, withValues);
    expect(b.otherAssets).toBe(525000);
    // apple card balance is a liability input
    const appleBalance = accounts.find((a) => a.id === accountId)!
      .currentBalance;
    expect(b.liabilities).toBeGreaterThanOrEqual(appleBalance);
    expect(b.netWorth).toBe(b.totalAssets - b.liabilities);
  });

  it("deleting an asset removes its valuation history", async () => {
    const asset = await repo.createAsset({
      name: "Old Bike",
      assetType: "vehicle",
      valuationMethod: "manual",
      currentValue: 900,
    });
    expect(await repo.deleteAsset(asset.id)).toBe(true);
    expect(await repo.getAssetValuations(asset.id)).toHaveLength(0);
    const rows = await db()
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.id, asset.id));
    expect(rows).toHaveLength(0);
  });
});
