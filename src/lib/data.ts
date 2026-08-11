/**
 * Data access facade for pages and API routes — backed by the database.
 * (Phase 1 served mock data; the DB now auto-migrates and auto-seeds the
 * same demo dataset on first run, so zero-setup dev still works.)
 */
import "server-only";
import type {
  Account,
  BalanceSnapshot,
  RecurringItem,
  Transaction,
} from "./domain/types";
import * as repo from "./repo";

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getAccounts(): Promise<Account[]> {
  return repo.getAccounts();
}

export async function getTransactions(): Promise<Transaction[]> {
  return repo.getTransactions();
}

export async function getSnapshots(): Promise<BalanceSnapshot[]> {
  return repo.getSnapshots();
}

export async function getRecurring(): Promise<RecurringItem[]> {
  return repo.getRecurring();
}

export interface SyncStatus {
  lastSyncedAt: string | null;
  status: "idle" | "syncing" | "error";
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const [lastSyncedAt, events] = await Promise.all([
    repo.getLastSyncedAt(),
    repo.getSyncEvents(1),
  ]);
  const latest = events[0];
  return {
    lastSyncedAt,
    status:
      latest?.status === "running"
        ? "syncing"
        : latest?.status === "error"
          ? "error"
          : "idle",
  };
}
