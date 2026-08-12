/**
 * Apple Card import orchestration (server-side).
 *
 * The parsed rows flow through the SAME ingestion path as provider syncs
 * (sync.ingestTransaction + sync.postProcess), so dedup, merchant rules,
 * user-edit preservation, transfer/CC-payment detection, recurring
 * detection, and analytics all apply identically. No parallel accounting.
 *
 * Uploaded documents are parsed in memory and never persisted; only the
 * normalized rows are saved. Statement contents are never logged.
 */
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, ensureDbReady, schema } from "@/db/client";
import { ingestTransaction, postProcess } from "@/lib/sync";
import {
  findStatementImport,
  recordStatementImport,
  toCents,
} from "@/lib/repo";
import {
  isAppleCardCsv,
  looksLikeAppleCardStatement,
  parseAppleCardCsv,
  parseAppleCardStatementText,
  toProviderTransactions,
  type ParsedStatement,
} from "./apple-card";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

const MANUAL_CONNECTION_ID = "conn_manual";

/** Ensure the shared "manual" connection exists (groups imported accounts). */
async function ensureManualConnection(): Promise<string> {
  const d = db();
  await d
    .insert(schema.financialConnections)
    .values({
      id: MANUAL_CONNECTION_ID,
      provider: "manual",
      providerItemId: "manual",
      status: "active",
    })
    .onConflictDoNothing();
  return MANUAL_CONNECTION_ID;
}

export async function createAppleCardAccount(input: {
  name?: string;
  mask?: string | null;
}): Promise<{ id: string }> {
  await ensureDbReady();
  const d = db();
  const connectionId = await ensureManualConnection();
  const id = `acc_${randomUUID()}`;
  await d.insert(schema.accounts).values({
    id,
    connectionId,
    providerAccountId: id,
    institutionName: "Apple Card",
    name: input.name?.trim() || "Apple Card",
    officialName: "APPLE CARD",
    type: "credit_card",
    mask: input.mask ?? null,
    currentBalanceCents: 0,
    currency: "USD",
    status: "active",
    lastSyncedAt: new Date(),
  });
  return { id };
}

export async function getAppleCardAccounts() {
  await ensureDbReady();
  return db()
    .select({ id: schema.accounts.id, name: schema.accounts.name })
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.institutionName, "Apple Card"),
        eq(schema.accounts.connectionId, MANUAL_CONNECTION_ID),
      ),
    );
}

export interface ParseResult {
  ok: true;
  source: "apple_card_pdf" | "apple_card_csv";
  statement: ParsedStatement;
  fileHash: string;
}

export interface ParseFailure {
  ok: false;
  error: string;
}

/** Validate + parse an upload entirely in memory. */
export async function parseUpload(
  fileName: string,
  bytes: Buffer,
): Promise<ParseResult | ParseFailure> {
  if (bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "File is larger than 10 MB." };
  }
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const isPdf = bytes.subarray(0, 5).toString("latin1") === "%PDF-";

  if (isPdf) {
    let text: string;
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const doc = await getDocumentProxy(new Uint8Array(bytes));
      const extracted = await extractText(doc, { mergePages: true });
      text = extracted.text;
    } catch {
      return {
        ok: false,
        error: "Could not read this PDF. Is it a valid, unencrypted file?",
      };
    }
    if (!looksLikeAppleCardStatement(text)) {
      return {
        ok: false,
        error: "This PDF doesn't look like an Apple Card monthly statement.",
      };
    }
    const statement = parseAppleCardStatementText(text);
    if (statement.rows.length === 0 && statement.uncertainCount === 0) {
      return {
        ok: false,
        error: "No transactions were found in this statement.",
      };
    }
    return { ok: true, source: "apple_card_pdf", statement, fileHash };
  }

  // Treat anything else as text; require the Wallet CSV header.
  const text = bytes.toString("utf8");
  if (fileName.toLowerCase().endsWith(".csv") || isAppleCardCsv(text)) {
    if (!isAppleCardCsv(text)) {
      return {
        ok: false,
        error:
          "This CSV doesn't match the Apple Card export format (expected the Wallet app's transaction export).",
      };
    }
    return {
      ok: true,
      source: "apple_card_csv",
      statement: parseAppleCardCsv(text),
      fileHash,
    };
  }
  return { ok: false, error: "Unsupported file type — upload a PDF or CSV." };
}

/** Which of these rows already exist (by stable provider id)? */
export async function markDuplicates(
  accountId: string,
  statement: ParsedStatement,
): Promise<boolean[]> {
  const d = db();
  const pts = toProviderTransactions(accountId, statement.rows);
  const flags: boolean[] = [];
  for (const pt of pts) {
    const [existing] = await d
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(
        eq(schema.transactions.providerTransactionId, pt.providerTransactionId),
      )
      .limit(1);
    flags.push(!!existing);
  }
  return flags;
}

export interface CommitSummary {
  added: number;
  duplicates: number;
  statementBalance: number | null;
}

/**
 * Commit previously previewed rows. `selected` filters by row index so the
 * user can exclude rows in the preview.
 */
export async function commitImport(
  accountId: string,
  source: "apple_card_pdf" | "apple_card_csv",
  fileHash: string,
  statement: ParsedStatement,
  selected?: number[],
): Promise<CommitSummary> {
  await ensureDbReady();
  const d = db();

  const [account] = await d
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, accountId))
    .limit(1);
  if (!account || account.institutionName !== "Apple Card") {
    throw new Error("Not an Apple Card account");
  }

  const rows =
    selected && selected.length > 0
      ? statement.rows.filter((_, i) => selected.includes(i))
      : statement.rows;

  // Occurrence indexes must be computed over the FULL statement so that a
  // partial re-import of the same file still generates identical ids.
  const allPts = toProviderTransactions(accountId, statement.rows);
  const keep = new Set(
    (selected && selected.length > 0
      ? selected
      : statement.rows.map((_, i) => i)),
  );
  const pts = allPts.filter((_, i) => keep.has(i));

  const rules = await d.select().from(schema.categoryRules);
  const accountMap = new Map([[accountId, accountId]]);
  let added = 0;
  let duplicates = 0;
  for (const pt of pts) {
    const result = await ingestTransaction(pt, accountMap, rules);
    if (result === "added") added += 1;
    else if (result === "modified") duplicates += 1;
  }

  // Statement balance (PDF) → account balance + snapshot at period end.
  let statementBalance: number | null = null;
  if (statement.statementBalanceCents !== null && statement.periodEnd) {
    statementBalance = statement.statementBalanceCents / 100;
    await d
      .update(schema.accounts)
      .set({
        currentBalanceCents: statement.statementBalanceCents,
        lastSyncedAt: new Date(),
      })
      .where(eq(schema.accounts.id, accountId));
    await d
      .insert(schema.balanceSnapshots)
      .values({
        id: randomUUID(),
        accountId,
        date: statement.periodEnd,
        balanceCents: statement.statementBalanceCents,
      })
      .onConflictDoUpdate({
        target: [
          schema.balanceSnapshots.accountId,
          schema.balanceSnapshots.date,
        ],
        set: { balanceCents: statement.statementBalanceCents },
      });
  } else {
    await d
      .update(schema.accounts)
      .set({ lastSyncedAt: new Date() })
      .where(eq(schema.accounts.id, accountId));
  }

  await recordStatementImport({
    accountId,
    source,
    fileHash,
    periodStart: statement.periodStart,
    periodEnd: statement.periodEnd,
    importedCount: added,
    duplicateCount: duplicates + (rows.length - added - duplicates),
    uncertainCount: statement.uncertainCount,
  });

  // Transfer/CC-payment detection + recurring refresh — the standard pass.
  await postProcess();

  await d.insert(schema.syncEvents).values({
    id: randomUUID(),
    connectionId: MANUAL_CONNECTION_ID,
    startedAt: new Date(),
    finishedAt: new Date(),
    status: "success",
    added,
    modified: duplicates,
    removed: 0,
    message: `Apple Card import: ${added} new, ${rows.length - added} already present`,
  });

  return { added, duplicates: rows.length - added, statementBalance };
}

export { findStatementImport, toCents };
