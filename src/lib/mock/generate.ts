/**
 * Deterministic fake dataset for Phase 1 development and demos.
 * ~13 months of realistic activity across 6 accounts at 3 institutions.
 * Transfer/CC-payment flags are NOT hardcoded — the generator emits raw
 * transactions and runs the real detectTransfers() over them, so the demo
 * data exercises production logic. No real financial data anywhere.
 */
import type {
  Account,
  BalanceSnapshot,
  Transaction,
  TransactionStatus,
} from "../domain/types";
import { detectTransfers } from "../domain/analytics";

// mulberry32 — tiny deterministic PRNG
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setUTCDate(c.getUTCDate() + n);
  return c;
}

export interface MockDataset {
  accounts: Account[];
  transactions: Transaction[];
  snapshots: BalanceSnapshot[];
}

const ACCOUNTS: Omit<Account, "currentBalance" | "lastSyncedAt">[] = [
  {
    id: "acc_chase_checking",
    institutionName: "Chase",
    name: "Chase Total Checking",
    officialName: "TOTAL CHECKING",
    type: "checking",
    mask: "4821",
    availableBalance: null,
    creditLimit: null,
    currency: "USD",
    status: "active",
  },
  {
    id: "acc_chase_savings",
    institutionName: "Chase",
    name: "Chase Savings",
    officialName: "PREMIER SAVINGS",
    type: "savings",
    mask: "9910",
    availableBalance: null,
    creditLimit: null,
    currency: "USD",
    status: "active",
  },
  {
    id: "acc_chase_sapphire",
    institutionName: "Chase",
    name: "Sapphire Preferred",
    officialName: "CHASE SAPPHIRE PREFERRED",
    type: "credit_card",
    mask: "3007",
    availableBalance: null,
    creditLimit: 15000,
    currency: "USD",
    status: "active",
  },
  {
    id: "acc_amex_gold",
    institutionName: "American Express",
    name: "Amex Gold",
    officialName: "AMERICAN EXPRESS GOLD CARD",
    type: "credit_card",
    mask: "1005",
    availableBalance: null,
    creditLimit: 20000,
    currency: "USD",
    status: "active",
  },
  {
    id: "acc_fid_401k",
    institutionName: "Fidelity",
    name: "401(k)",
    officialName: "FIDELITY 401K PLAN",
    type: "retirement",
    mask: "7734",
    availableBalance: null,
    creditLimit: null,
    currency: "USD",
    status: "active",
  },
  {
    id: "acc_fid_brokerage",
    institutionName: "Fidelity",
    name: "Brokerage",
    officialName: "FIDELITY BROKERAGE",
    type: "investment",
    mask: "2201",
    availableBalance: null,
    creditLimit: null,
    currency: "USD",
    status: "active",
  },
];

interface RawTxn {
  accountId: string;
  date: string;
  merchant: string;
  rawDescription: string;
  amount: number;
  categoryId: string;
  providerCategory: string;
}

export function generateMockData(todayIso: string): MockDataset {
  const rand = rng(20260810);
  const today = new Date(todayIso + "T00:00:00Z");
  const start = addDays(today, -400);
  const raw: RawTxn[] = [];

  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const between = (lo: number, hi: number) =>
    Math.round((lo + rand() * (hi - lo)) * 100) / 100;

  const CHECKING = "acc_chase_checking";
  const SAVINGS = "acc_chase_savings";
  const SAPPHIRE = "acc_chase_sapphire";
  const AMEX = "acc_amex_gold";
  const BROKERAGE = "acc_fid_brokerage";

  const groceryStores = ["Trader Joe's", "Whole Foods", "Safeway", "Costco"];
  const restaurants = [
    "Chipotle",
    "Sweetgreen",
    "Shake Shack",
    "Nobu",
    "Joe's Pizza",
    "Blue Bottle Coffee",
    "Starbucks",
    "Tartine Bakery",
    "Din Tai Fung",
  ];
  const shops = ["Amazon", "Target", "Uniqlo", "Best Buy", "REI", "Sephora"];
  const entertainment = ["AMC Theatres", "Ticketmaster", "Steam", "Barnes & Noble"];

  // track monthly card charges so payments roughly match
  const cardCharges = new Map<string, Map<string, number>>(); // accountId -> ym -> sum
  const addCharge = (acct: string, date: string, amt: number) => {
    const ym = date.slice(0, 7);
    const m = cardCharges.get(acct) ?? new Map();
    m.set(ym, (m.get(ym) ?? 0) + amt);
    cardCharges.set(acct, m);
  };

  const push = (t: RawTxn) => {
    raw.push(t);
    if (t.accountId === SAPPHIRE || t.accountId === AMEX) {
      if (t.amount > 0) addCharge(t.accountId, t.date, t.amount);
    }
  };

  for (let d = new Date(start); d <= today; d = addDays(d, 1)) {
    const date = iso(d);
    const dow = d.getUTCDay();
    const dom = d.getUTCDate();
    const ym = date.slice(0, 7);

    // Salary: biweekly Friday (anchored to epoch week parity)
    const weekIndex = Math.floor(d.getTime() / (7 * 86_400_000));
    if (dow === 5 && weekIndex % 2 === 1) {
      push({
        accountId: CHECKING,
        date,
        merchant: "Acme Corp",
        rawDescription: "ACME CORP PAYROLL DIR DEP",
        amount: -3247.18,
        categoryId: "salary",
        providerCategory: "INCOME",
      });
    }

    // Annual bonus in December
    if (dom === 15 && date.slice(5, 7) === "12") {
      push({
        accountId: CHECKING,
        date,
        merchant: "Acme Corp",
        rawDescription: "ACME CORP BONUS DIR DEP",
        amount: -4000,
        categoryId: "bonus",
        providerCategory: "INCOME",
      });
    }

    if (dom === 1) {
      // Rent
      push({
        accountId: CHECKING,
        date,
        merchant: "Hudson Property Management",
        rawDescription: "HUDSON PROPERTY MGMT RENT ACH",
        amount: 2150,
        categoryId: "housing",
        providerCategory: "RENT_AND_UTILITIES",
      });
      // Transfer to savings (both sides; detectTransfers pairs them)
      push({
        accountId: CHECKING,
        date,
        merchant: "Transfer to Savings",
        rawDescription: "ONLINE TRANSFER TO SAV ...9910",
        amount: 500,
        categoryId: "transfer",
        providerCategory: "TRANSFER_OUT",
      });
      push({
        accountId: SAVINGS,
        date,
        merchant: "Transfer from Checking",
        rawDescription: "ONLINE TRANSFER FROM CHK ...4821",
        amount: -500,
        categoryId: "transfer",
        providerCategory: "TRANSFER_IN",
      });
    }

    if (dom === 3) {
      push({
        accountId: CHECKING,
        date,
        merchant: "Con Edison",
        rawDescription: "CONED ELEC BILL PAYMENT",
        amount: between(95, 210),
        categoryId: "utilities",
        providerCategory: "RENT_AND_UTILITIES",
      });
    }
    if (dom === 6) {
      push({
        accountId: CHECKING,
        date,
        merchant: "Verizon Fios",
        rawDescription: "VERIZON FIOS INTERNET",
        amount: 64.99,
        categoryId: "utilities",
        providerCategory: "RENT_AND_UTILITIES",
      });
      push({
        accountId: CHECKING,
        date,
        merchant: "Geico",
        rawDescription: "GEICO AUTO INSURANCE PREM",
        amount: 128.4,
        categoryId: "insurance",
        providerCategory: "GENERAL_SERVICES",
      });
    }
    if (dom === 9) {
      push({
        accountId: SAPPHIRE,
        date,
        merchant: "T-Mobile",
        rawDescription: "TMOBILE*AUTO PAY",
        amount: 85,
        categoryId: "utilities",
        providerCategory: "RENT_AND_UTILITIES",
      });
    }

    // Subscriptions
    if (dom === 5)
      push({
        accountId: AMEX,
        date,
        merchant: "Netflix",
        rawDescription: "NETFLIX.COM",
        amount: 15.49,
        categoryId: "subscriptions",
        providerCategory: "ENTERTAINMENT",
      });
    if (dom === 12)
      push({
        accountId: AMEX,
        date,
        merchant: "Spotify",
        rawDescription: "SPOTIFY USA",
        amount: 11.99,
        categoryId: "subscriptions",
        providerCategory: "ENTERTAINMENT",
      });
    if (dom === 17)
      push({
        accountId: SAPPHIRE,
        date,
        merchant: "iCloud",
        rawDescription: "APPLE.COM/BILL ICLOUD",
        amount: 2.99,
        categoryId: "subscriptions",
        providerCategory: "GENERAL_SERVICES",
      });
    if (dom === 20)
      push({
        accountId: CHECKING,
        date,
        merchant: "Crunch Fitness",
        rawDescription: "CRUNCH FITNESS MEMBERSHIP",
        amount: 29.99,
        categoryId: "personal",
        providerCategory: "PERSONAL_CARE",
      });
    if (dom === 22)
      push({
        accountId: SAPPHIRE,
        date,
        merchant: "The New York Times",
        rawDescription: "NYTIMES*NYTIMES SUBSCRIPTION",
        amount: 17,
        categoryId: "subscriptions",
        providerCategory: "ENTERTAINMENT",
      });
    if (dom === 25)
      push({
        accountId: CHECKING,
        date,
        merchant: "Lemonade",
        rawDescription: "LEMONADE INSURANCE RENTERS",
        amount: 22.75,
        categoryId: "insurance",
        providerCategory: "GENERAL_SERVICES",
      });

    // Savings interest at month end
    if (dom === 28) {
      push({
        accountId: SAVINGS,
        date,
        merchant: "Interest Payment",
        rawDescription: "INTEREST PAYMENT",
        amount: -between(72, 88),
        categoryId: "interest",
        providerCategory: "INCOME",
      });
    }

    // Quarterly dividends on brokerage
    if (dom === 10 && ["03", "06", "09", "12"].includes(date.slice(5, 7))) {
      push({
        accountId: BROKERAGE,
        date,
        merchant: "Vanguard Total Market ETF",
        rawDescription: "DIVIDEND VTI",
        amount: -between(95, 160),
        categoryId: "dividends",
        providerCategory: "INCOME",
      });
    }

    // Groceries: Sat + occasionally Wed
    if (dow === 6 || (dow === 3 && rand() < 0.4)) {
      push({
        accountId: rand() < 0.7 ? SAPPHIRE : AMEX,
        date,
        merchant: pick(groceryStores),
        rawDescription: "POS PURCHASE",
        amount: between(38, 145),
        categoryId: "groceries",
        providerCategory: "FOOD_AND_DRINK",
      });
    }

    // Restaurants / coffee
    if (rand() < 0.45) {
      const m = pick(restaurants);
      push({
        accountId: rand() < 0.6 ? AMEX : SAPPHIRE,
        date,
        merchant: m,
        rawDescription: m.toUpperCase(),
        amount:
          m === "Nobu"
            ? between(120, 260)
            : m === "Starbucks" || m === "Blue Bottle Coffee"
              ? between(5, 14)
              : between(14, 68),
        categoryId: "restaurants",
        providerCategory: "FOOD_AND_DRINK",
      });
    }

    // Transportation
    if (dow === 1) {
      push({
        accountId: SAPPHIRE,
        date,
        merchant: "MTA",
        rawDescription: "MTA*NYCT PAYGO",
        amount: 34,
        categoryId: "transportation",
        providerCategory: "TRANSPORTATION",
      });
    }
    if (rand() < 0.12) {
      push({
        accountId: rand() < 0.5 ? AMEX : SAPPHIRE,
        date,
        merchant: "Uber",
        rawDescription: "UBER TRIP",
        amount: between(9, 42),
        categoryId: "transportation",
        providerCategory: "TRANSPORTATION",
      });
    }

    // Shopping
    if (rand() < 0.22) {
      const m = pick(shops);
      push({
        accountId: rand() < 0.65 ? SAPPHIRE : AMEX,
        date,
        merchant: m,
        rawDescription: m === "Amazon" ? "AMZN MKTP US" : m.toUpperCase(),
        amount: between(18, 160),
        categoryId: "shopping",
        providerCategory: "GENERAL_MERCHANDISE",
      });
      // occasional refund a few days later (recorded immediately for simplicity)
      if (m === "Amazon" && rand() < 0.12) {
        push({
          accountId: SAPPHIRE,
          date: iso(addDays(d, 3) <= today ? addDays(d, 3) : d),
          merchant: "Amazon",
          rawDescription: "AMZN MKTP US REFUND",
          amount: -between(18, 60),
          categoryId: "shopping",
          providerCategory: "GENERAL_MERCHANDISE",
        });
      }
    }

    // Entertainment
    if (rand() < 0.08) {
      const m = pick(entertainment);
      push({
        accountId: AMEX,
        date,
        merchant: m,
        rawDescription: m.toUpperCase(),
        amount: between(14, 120),
        categoryId: "entertainment",
        providerCategory: "ENTERTAINMENT",
      });
    }

    // Healthcare: roughly monthly pharmacy
    if (dom === 14 && rand() < 0.7) {
      push({
        accountId: SAPPHIRE,
        date,
        merchant: "CVS Pharmacy",
        rawDescription: "CVS/PHARMACY",
        amount: between(12, 55),
        categoryId: "healthcare",
        providerCategory: "MEDICAL",
      });
    }

    // Travel: a few trips per year (Apr/Jul/Nov, day 18)
    if (dom === 18 && ["04", "07", "11"].includes(date.slice(5, 7))) {
      push({
        accountId: SAPPHIRE,
        date,
        merchant: "United Airlines",
        rawDescription: "UNITED 0162345678901",
        amount: between(260, 540),
        categoryId: "travel",
        providerCategory: "TRAVEL",
      });
      push({
        accountId: SAPPHIRE,
        date: iso(addDays(d, 2) <= today ? addDays(d, 2) : d),
        merchant: "Marriott",
        rawDescription: "MARRIOTT HOTELS",
        amount: between(320, 720),
        categoryId: "travel",
        providerCategory: "TRAVEL",
      });
    }

    // Credit card payments on the 26th: pay previous month's charges
    if (dom === 26) {
      const prevYm = prevMonth(ym);
      for (const [card, desc, thank] of [
        [SAPPHIRE, "CHASE CREDIT CRD AUTOPAY", "AUTOMATIC PAYMENT - THANK YOU"],
        [AMEX, "AMEX EPAYMENT ACH PMT", "ONLINE PAYMENT - THANK YOU"],
      ] as const) {
        const amt = Math.round((cardCharges.get(card)?.get(prevYm) ?? 0) * 100) / 100;
        if (amt <= 0) continue;
        push({
          accountId: CHECKING,
          date,
          merchant: card === SAPPHIRE ? "Chase Card Payment" : "Amex Payment",
          rawDescription: desc,
          amount: amt,
          categoryId: "credit_card_payment",
          providerCategory: "LOAN_PAYMENTS",
        });
        push({
          accountId: card,
          date,
          merchant: "Payment",
          rawDescription: thank,
          amount: -amt,
          categoryId: "credit_card_payment",
          providerCategory: "LOAN_PAYMENTS",
        });
      }
    }
  }

  // ---- assemble transactions ----
  const pendingCutoff = iso(addDays(today, -2));
  let seq = 0;
  const txns: Transaction[] = raw
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => {
      seq += 1;
      const status: TransactionStatus =
        r.date >= pendingCutoff &&
        (r.accountId === SAPPHIRE || r.accountId === AMEX)
          ? "pending"
          : "posted";
      return {
        id: `txn_${String(seq).padStart(5, "0")}`,
        accountId: r.accountId,
        providerTransactionId: `mock_${String(seq).padStart(5, "0")}`,
        date: r.date,
        merchant: r.merchant,
        rawDescription: r.rawDescription,
        amount: r.amount,
        currency: "USD",
        status,
        categoryId: r.categoryId,
        categorySource: "provider" as const,
        providerCategory: r.providerCategory,
        isTransfer: false,
        transferPairId: null,
        notes: null,
      };
    });

  // ---- balances: simulate forward from opening balances ----
  const opening: Record<string, number> = {
    [CHECKING]: 6200,
    [SAVINGS]: 17500,
    [SAPPHIRE]: 0,
    [AMEX]: 0,
    acc_fid_401k: 54000,
    [BROKERAGE]: 26500,
  };
  const balances = { ...opening };
  const snapshots: BalanceSnapshot[] = [];
  const txnsByDate = new Map<string, Transaction[]>();
  for (const t of txns) {
    const arr = txnsByDate.get(t.date) ?? [];
    arr.push(t);
    txnsByDate.set(t.date, arr);
  }

  const growth = rng(7);
  for (let d = new Date(start); d <= today; d = addDays(d, 1)) {
    const date = iso(d);
    for (const t of txnsByDate.get(date) ?? []) {
      if (t.accountId === SAPPHIRE || t.accountId === AMEX) {
        balances[t.accountId] += t.amount; // owed grows with charges
      } else {
        balances[t.accountId] -= t.amount; // asset falls with outflow
      }
    }
    const isMonthEnd = addDays(d, 1).getUTCDate() === 1;
    if (isMonthEnd || iso(d) === iso(today)) {
      // investment drift + contributions at month boundaries
      if (isMonthEnd) {
        balances.acc_fid_401k =
          Math.round(balances.acc_fid_401k * (1 + 0.004 + growth() * 0.012) * 100) /
            100 +
          500;
        balances[BROKERAGE] =
          Math.round(balances[BROKERAGE] * (1 + 0.002 + growth() * 0.011) * 100) /
          100;
      }
      for (const [accountId, balance] of Object.entries(balances)) {
        snapshots.push({
          accountId,
          date,
          balance: Math.round(balance * 100) / 100,
        });
      }
    }
  }

  const syncedAt = new Date(today.getTime() + 14 * 3600_000).toISOString();
  const accounts: Account[] = ACCOUNTS.map((a) => ({
    ...a,
    currentBalance: Math.round(balances[a.id] * 100) / 100,
    availableBalance:
      a.type === "credit_card" && a.creditLimit
        ? Math.round((a.creditLimit - balances[a.id]) * 100) / 100
        : a.type === "checking" || a.type === "savings"
          ? Math.round(balances[a.id] * 100) / 100
          : null,
    lastSyncedAt: syncedAt,
  }));

  // Run the REAL transfer detection over the generated data
  const finalTxns = detectTransfers(txns, accounts);

  return { accounts, transactions: finalTxns, snapshots };
}

function prevMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
