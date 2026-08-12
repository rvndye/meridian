/**
 * Controlled tools for the AI assistant. The model NEVER touches the
 * database — every tool calls the same repository + pure-analytics layer the
 * dashboard uses, and all arithmetic happens here in code. Tool results are
 * compact JSON strings.
 */
import "server-only";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import * as repo from "@/lib/repo";
import { todayIso } from "@/lib/data";
import {
  compareSpendingByCategory,
  incomeByCategory,
  isIncome,
  isSpending,
  lastMonths,
  monthlyCashFlow,
  netWorthSeries,
  spendingByCategory,
  spendingByMerchant,
  totalsForRange,
} from "@/lib/domain/analytics";
import { CATEGORIES, categoryName } from "@/lib/domain/categories";
import {
  assetAppreciation,
  assetEquity,
  assetValueSeries,
  effectiveAssetValue,
  liquidBreakdown,
  netWorthBreakdown,
} from "@/lib/domain/assets";

const round = (n: number) => Math.round(n * 100) / 100;

const dateProp = (desc: string) => ({
  type: "string" as const,
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
  description: `${desc} (YYYY-MM-DD)`,
});

export function buildAssistantTools() {
  return [
    betaTool({
      name: "get_account_balances",
      description:
        "Current balances for every account (checking, savings, credit cards, investments). Credit card balances are the amount owed.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => {
        const accounts = await repo.getAccounts();
        return JSON.stringify(
          accounts.map((a) => ({
            name: a.name,
            institution: a.institutionName,
            type: a.type,
            currentBalance: a.currentBalance,
            availableBalance: a.availableBalance,
            creditLimit: a.creditLimit,
          })),
        );
      },
    }),

    betaTool({
      name: "get_net_worth",
      description:
        "Net worth summary: financial assets (connected accounts), other tracked assets (property, vehicles, …), total assets, liabilities, net worth, the liquid share, and change over the current month and year.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => {
        const [accounts, snapshots, assets, valuations] = await Promise.all([
          repo.getAccounts(),
          repo.getSnapshots(),
          repo.getAssets(),
          repo.getAssetValuations(),
        ]);
        const today = todayIso();
        const withValues = assets.map((asset) => ({
          asset,
          value: asset.currentValue,
        }));
        const breakdown = netWorthBreakdown(accounts, withValues);
        const liquid = liquidBreakdown(accounts, withValues);

        // Time series includes tracked assets (valuations carried forward)
        const valuationsByAsset = new Map<string, typeof valuations>();
        for (const v of valuations) {
          const arr = valuationsByAsset.get(v.assetId) ?? [];
          arr.push(v);
          valuationsByAsset.set(v.assetId, arr);
        }
        const dates = [...new Set(snapshots.map((s) => s.date))].sort();
        const financialSeries = netWorthSeries(accounts, snapshots, dates);
        const series = financialSeries.map((p) => {
          let assetTotal = 0;
          for (const a of assets) {
            assetTotal += assetValueSeries(
              a,
              valuationsByAsset.get(a.id) ?? [],
              [p.date],
            )[0].value;
          }
          return { date: p.date, netWorth: p.netWorth + assetTotal };
        });
        const monthStart = [...series]
          .reverse()
          .find((p) => p.date < `${today.slice(0, 7)}-01`);
        const yearStart = [...series]
          .reverse()
          .find((p) => p.date < `${today.slice(0, 4)}-01-01`);
        return JSON.stringify({
          financialAssets: round(breakdown.financialAssets),
          otherAssets: round(breakdown.otherAssets),
          otherAssetsByType: Object.fromEntries(
            Object.entries(breakdown.otherAssetsByType).map(([k, v]) => [
              k,
              round(v),
            ]),
          ),
          totalAssets: round(breakdown.totalAssets),
          liabilities: round(breakdown.liabilities),
          netWorth: round(breakdown.netWorth),
          liquidAssets: round(liquid.liquid),
          liquidShareOfAssets:
            liquid.share !== null ? round(liquid.share) : null,
          changeThisMonth: monthStart
            ? round(breakdown.netWorth - monthStart.netWorth)
            : null,
          changeThisYear: yearStart
            ? round(breakdown.netWorth - yearStart.netWorth)
            : null,
        });
      },
    }),

    betaTool({
      name: "get_assets",
      description:
        "All manually tracked assets (real estate, vehicles, collectibles, …) with current value, valuation method, share of total assets, purchase info, and any linked loan. Sorted largest first.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => {
        const [assets, accounts] = await Promise.all([
          repo.getAssets(),
          repo.getAccounts(),
        ]);
        const withValues = assets.map((asset) => ({
          asset,
          value: asset.currentValue,
        }));
        const { totalAssets } = netWorthBreakdown(accounts, withValues);
        const liabilityById = new Map(accounts.map((a) => [a.id, a]));
        return JSON.stringify(
          assets
            .sort((a, b) => b.currentValue - a.currentValue)
            .map((a) => {
              const liability = a.liabilityAccountId
                ? liabilityById.get(a.liabilityAccountId)
                : null;
              const equity = liability
                ? assetEquity(a.currentValue, liability.currentBalance)
                : null;
              return {
                name: a.name,
                type: a.assetType,
                currentValue: round(a.currentValue),
                valuationMethod: a.valuationMethod,
                shareOfTotalAssets:
                  totalAssets > 0 ? round(a.currentValue / totalAssets) : null,
                purchaseDate: a.purchaseDate,
                purchasePrice: a.purchasePrice,
                address: a.address,
                linkedLiability: liability
                  ? {
                      name: liability.name,
                      balance: round(liability.currentBalance),
                      equity: round(equity!.equity),
                    }
                  : null,
              };
            }),
        );
      },
    }),

    betaTool({
      name: "get_asset_value_history",
      description:
        "Valuation history for one tracked asset (matched by name, case-insensitive substring): every recorded valuation with date/source, plus appreciation since purchase and over an optional date range. Use for questions like 'how has my property value changed'.",
      inputSchema: {
        type: "object",
        properties: {
          asset_name: {
            type: "string",
            description: "Asset name or a distinctive part of it",
          },
          start_date: { ...dateProp("Optional window start"), },
          end_date: { ...dateProp("Optional window end") },
        },
        required: ["asset_name"],
        additionalProperties: false,
      },
      run: async (input: {
        asset_name: string;
        start_date?: string;
        end_date?: string;
      }) => {
        const assets = await repo.getAssets();
        const needle = input.asset_name.toLowerCase();
        const asset = assets.find((a) =>
          a.name.toLowerCase().includes(needle),
        );
        if (!asset) {
          return JSON.stringify({
            error: `No asset matching "${input.asset_name}". Known assets: ${assets.map((a) => a.name).join(", ") || "none"}`,
          });
        }
        const valuations = await repo.getAssetValuations(asset.id);
        const effective = effectiveAssetValue(asset, valuations);
        const window =
          input.start_date && input.end_date
            ? assetAppreciation(
                asset,
                valuations,
                input.start_date,
                input.end_date,
              )
            : null;
        return JSON.stringify({
          name: asset.name,
          currentValue: round(effective.value),
          valueSource: effective.source,
          automatedEstimate: effective.automated
            ? {
                value: round(effective.automated.value),
                low: effective.automated.valueLow,
                high: effective.automated.valueHigh,
                asOf: effective.automated.asOf,
              }
            : null,
          manualValue: effective.manual,
          purchasePrice: asset.purchasePrice,
          appreciationSincePurchase:
            asset.purchasePrice !== null
              ? round(effective.value - asset.purchasePrice)
              : null,
          windowChange: window ? round(window.change) : null,
          history: valuations.map((v) => ({
            date: v.valuationDate,
            value: round(v.value),
            source: v.source,
          })),
        });
      },
    }),

    betaTool({
      name: "get_property_equity",
      description:
        "Equity for assets with a linked loan/mortgage: market value, remaining balance, and equity (value minus balance). Without a name, returns every asset that has a linked liability.",
      inputSchema: {
        type: "object",
        properties: {
          asset_name: {
            type: "string",
            description: "Optional asset name filter (substring)",
          },
        },
        additionalProperties: false,
      },
      run: async (input: { asset_name?: string }) => {
        const [assets, accounts] = await Promise.all([
          repo.getAssets(),
          repo.getAccounts(),
        ]);
        const byId = new Map(accounts.map((a) => [a.id, a]));
        const needle = input.asset_name?.toLowerCase();
        const rows = assets
          .filter((a) => a.liabilityAccountId)
          .filter((a) => !needle || a.name.toLowerCase().includes(needle))
          .map((a) => {
            const liability = byId.get(a.liabilityAccountId!);
            const { equity, liabilityBalance } = assetEquity(
              a.currentValue,
              liability?.currentBalance ?? null,
            );
            return {
              name: a.name,
              marketValue: round(a.currentValue),
              liability: liability?.name ?? "unknown",
              remainingBalance: round(liabilityBalance),
              equity: round(equity),
            };
          });
        return JSON.stringify(
          rows.length > 0
            ? rows
            : {
                note: "No assets have a linked loan or mortgage. Equity equals full market value for unlinked assets.",
              },
        );
      },
    }),

    betaTool({
      name: "get_spending_by_category",
      description:
        "Total spending and per-category breakdown for a date range. Spending excludes transfers and credit-card payments, and is net of refunds.",
      inputSchema: {
        type: "object",
        properties: {
          start_date: dateProp("Range start, inclusive"),
          end_date: dateProp("Range end, inclusive"),
        },
        required: ["start_date", "end_date"],
        additionalProperties: false,
      },
      run: async (input: { start_date: string; end_date: string }) => {
        const txns = await repo.getTransactions();
        const totals = totalsForRange(txns, input.start_date, input.end_date);
        const cats = spendingByCategory(txns, input.start_date, input.end_date);
        return JSON.stringify({
          totalSpending: round(totals.spending),
          byCategory: cats.map((c) => ({
            category: categoryName(c.categoryId),
            amount: round(c.amount),
            transactionCount: c.count,
          })),
        });
      },
    }),

    betaTool({
      name: "get_income",
      description:
        "Total income and per-source breakdown for a date range. Transfers between own accounts never count as income.",
      inputSchema: {
        type: "object",
        properties: {
          start_date: dateProp("Range start, inclusive"),
          end_date: dateProp("Range end, inclusive"),
        },
        required: ["start_date", "end_date"],
        additionalProperties: false,
      },
      run: async (input: { start_date: string; end_date: string }) => {
        const txns = await repo.getTransactions();
        const totals = totalsForRange(txns, input.start_date, input.end_date);
        const sources = incomeByCategory(txns, input.start_date, input.end_date);
        return JSON.stringify({
          totalIncome: round(totals.income),
          bySource: sources.map((s) => ({
            source: categoryName(s.categoryId),
            amount: round(s.amount),
            transactionCount: s.count,
          })),
        });
      },
    }),

    betaTool({
      name: "get_cash_flow",
      description:
        "Monthly income, spending, and net cash flow (savings) for the last N months including the current month-to-date.",
      inputSchema: {
        type: "object",
        properties: {
          months: {
            type: "integer",
            minimum: 1,
            maximum: 24,
            description: "How many months back to include (default 6)",
          },
        },
        additionalProperties: false,
      },
      run: async (input: { months?: number }) => {
        const txns = await repo.getTransactions();
        const ym = todayIso().slice(0, 7);
        const flow = monthlyCashFlow(txns, lastMonths(ym, input.months ?? 6));
        return JSON.stringify(
          flow.map((m) => ({
            month: m.month,
            income: round(m.income),
            spending: round(m.spending),
            net: round(m.net),
          })),
        );
      },
    }),

    betaTool({
      name: "get_transactions",
      description:
        "Search transactions by date range with optional merchant substring, category, and flow-type filters. Returns matches (newest first, capped) plus the full match count and summed amounts.",
      inputSchema: {
        type: "object",
        properties: {
          start_date: dateProp("Range start, inclusive"),
          end_date: dateProp("Range end, inclusive"),
          merchant: {
            type: "string",
            description: "Case-insensitive substring of merchant name",
          },
          category: {
            type: "string",
            enum: CATEGORIES.map((c) => c.id),
            description: "Normalized category id",
          },
          flow: {
            type: "string",
            enum: ["expense", "income", "transfer", "all"],
            description: "Filter by flow type (default all)",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            description: "Max transactions to return (default 20)",
          },
        },
        required: ["start_date", "end_date"],
        additionalProperties: false,
      },
      run: async (input: {
        start_date: string;
        end_date: string;
        merchant?: string;
        category?: string;
        flow?: string;
        limit?: number;
      }) => {
        const txns = await repo.getTransactions();
        const q = input.merchant?.toLowerCase();
        const matches = txns.filter((t) => {
          if (t.date < input.start_date || t.date > input.end_date) return false;
          if (q && !t.merchant.toLowerCase().includes(q)) return false;
          if (input.category && t.categoryId !== input.category) return false;
          if (input.flow === "expense" && !isSpending(t)) return false;
          if (input.flow === "income" && !isIncome(t)) return false;
          if (input.flow === "transfer" && !t.isTransfer) return false;
          return true;
        });
        const totalSpent = matches
          .filter((t) => isSpending(t))
          .reduce((s, t) => s + t.amount, 0);
        const totalReceived = matches
          .filter((t) => isIncome(t))
          .reduce((s, t) => s - t.amount, 0);
        return JSON.stringify({
          matchCount: matches.length,
          totalSpent: round(totalSpent),
          totalReceived: round(totalReceived),
          transactions: matches
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, input.limit ?? 20)
            .map((t) => ({
              date: t.date,
              merchant: t.merchant,
              amount: t.amount,
              category: categoryName(t.categoryId),
              account: t.accountId,
              pending: t.status === "pending",
              isTransfer: t.isTransfer,
            })),
        });
      },
    }),

    betaTool({
      name: "get_recurring_transactions",
      description:
        "Detected recurring transactions and subscriptions: merchant, cadence, typical amount, next expected date, annualized cost. Negative typical amounts are recurring income.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => {
        const items = await repo.getRecurring();
        return JSON.stringify(
          items.map((r) => ({
            merchant: r.merchant,
            category: categoryName(r.categoryId),
            cadence: r.cadence,
            typicalAmount: r.typicalAmount,
            nextExpectedDate: r.nextExpectedDate,
            annualizedCost: r.annualizedCost,
            active: r.active,
          })),
        );
      },
    }),

    betaTool({
      name: "compare_periods",
      description:
        "Compare spending between two date ranges: totals plus the biggest per-category increases and decreases. Use to answer 'why was spending higher' questions.",
      inputSchema: {
        type: "object",
        properties: {
          current_start: dateProp("Current period start"),
          current_end: dateProp("Current period end"),
          previous_start: dateProp("Previous period start"),
          previous_end: dateProp("Previous period end"),
        },
        required: [
          "current_start",
          "current_end",
          "previous_start",
          "previous_end",
        ],
        additionalProperties: false,
      },
      run: async (input: {
        current_start: string;
        current_end: string;
        previous_start: string;
        previous_end: string;
      }) => {
        const txns = await repo.getTransactions();
        const cur = totalsForRange(txns, input.current_start, input.current_end);
        const prev = totalsForRange(
          txns,
          input.previous_start,
          input.previous_end,
        );
        const byCategory = compareSpendingByCategory(
          txns,
          input.current_start,
          input.current_end,
          input.previous_start,
          input.previous_end,
        );
        return JSON.stringify({
          current: { income: round(cur.income), spending: round(cur.spending) },
          previous: {
            income: round(prev.income),
            spending: round(prev.spending),
          },
          spendingChange: round(cur.spending - prev.spending),
          categoryChanges: byCategory.slice(0, 10).map((c) => ({
            category: categoryName(c.categoryId),
            current: round(c.current),
            previous: round(c.previous),
            change: round(c.change),
          })),
        });
      },
    }),

    betaTool({
      name: "get_spending_by_merchant",
      description:
        "Top merchants by total spending in a date range (net of refunds; transfers excluded).",
      inputSchema: {
        type: "object",
        properties: {
          start_date: dateProp("Range start, inclusive"),
          end_date: dateProp("Range end, inclusive"),
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 30,
            description: "Max merchants (default 10)",
          },
        },
        required: ["start_date", "end_date"],
        additionalProperties: false,
      },
      run: async (input: {
        start_date: string;
        end_date: string;
        limit?: number;
      }) => {
        const txns = await repo.getTransactions();
        const merchants = spendingByMerchant(
          txns,
          input.start_date,
          input.end_date,
          input.limit ?? 10,
        );
        return JSON.stringify(
          merchants.map((m) => ({
            merchant: m.merchant,
            amount: round(m.amount),
            transactionCount: m.count,
          })),
        );
      },
    }),
  ];
}
