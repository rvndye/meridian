/**
 * Apple Card parser unit tests — entirely fake statement data.
 */
import { describe, expect, it } from "vitest";
import {
  appleTransactionId,
  isAppleCardCsv,
  parseAppleCardCsv,
  parseAppleCardStatementText,
  toProviderTransactions,
} from "../src/lib/imports/apple-card";

const CSV = `Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By
08/01/2026,08/02/2026,APPLE.COM/BILL,Apple,Shopping,Purchase,49.99,Test User
08/03/2026,08/04/2026,WHOLE FOODS MARKET,Whole Foods,Grocery,Purchase,84.21,Test User
08/05/2026,08/05/2026,ACH DEPOSIT INTERNET PAYMENT,Apple Card Payment,Other,Payment,-1500.00,Test User
08/07/2026,08/08/2026,"NIKE, INC RETURN",Nike,Shopping,Credit,-62.50,Test User
08/09/2026,08/10/2026,BLUE BOTTLE COFFEE,Blue Bottle,Restaurants,Purchase,6.75,Test User
08/09/2026,08/10/2026,BLUE BOTTLE COFFEE,Blue Bottle,Restaurants,Purchase,6.75,Test User`;

// Mirrors the real statement layout: yearless first period date, a column
// header row, a payment printed WITHOUT a minus sign, a merchant wrapped
// across three lines, and an installments section whose origination row
// (old date, full financed amount) must never import.
const PDF_TEXT = `
Apple Card transactions $1,000.00
Apple Card Monthly Installments $649.00
Your August Balance
as of Aug 31, 2026
Total Balance $2,431.09
Apple Card Customer
Statement
Aug 1 — Aug 31, 2026
Payments
Date Description Amount
08/05/2026 ACH Deposit Internet Payment ACH Deposit $1,500.00
Total payments for this period -$1,500.00
Transactions
08/01/2026 APPLE.COM/BILL 866-712-7753 CA 3% $1.50 $49.99
08/03/2026 WHOLE FOODS MARKET SPRINGFIELD IL 2% $1.68 $84.21
08/04/2026 OVERSEAS MERCHANT THE LONG BANK BUILDING NOS. 721-725 SOME
KOWLOON HK
2% $1.10 $54.80
08/07/2026 NIKE, INC RETURN BEAVERTON OR -$62.50
08/12/2026 GARBLED LINE WITHOUT AMOUNT
Interest Charged
08/31/2026 Interest Charge on Purchases $12.40
Apple Card Monthly Installments
Dates Description Daily Cash Amounts
05/19/2026 IPHONE 17 PRO INSTALLMENT PLAN $1,299.00
This month's installment: $54.13
`;

describe("Apple Card CSV parsing", () => {
  it("detects the Wallet export header", () => {
    expect(isAppleCardCsv(CSV)).toBe(true);
    expect(isAppleCardCsv("Date,Amount\n01/01/2026,5")).toBe(false);
  });

  it("parses rows with types, signs, and quoted fields", () => {
    const parsed = parseAppleCardCsv(CSV);
    expect(parsed.rows).toHaveLength(6);
    expect(parsed.uncertainCount).toBe(0);

    const purchase = parsed.rows[0];
    expect(purchase).toMatchObject({
      date: "2026-08-01",
      postedDate: "2026-08-02",
      amountCents: 4999,
      type: "purchase",
      appleCategory: "Shopping",
    });

    const payment = parsed.rows[2];
    expect(payment.type).toBe("payment");
    expect(payment.amountCents).toBe(-150000);

    const refund = parsed.rows[3];
    expect(refund.type).toBe("credit");
    expect(refund.amountCents).toBe(-6250);
    expect(refund.description).toBe("NIKE, INC RETURN");

    expect(parsed.periodStart).toBe("2026-08-01");
    expect(parsed.periodEnd).toBe("2026-08-09");
  });
});

describe("Apple Card PDF statement parsing", () => {
  it("extracts the period from a yearless first date and finds the balance", () => {
    const parsed = parseAppleCardStatementText(PDF_TEXT);
    expect(parsed.periodStart).toBe("2026-08-01");
    expect(parsed.periodEnd).toBe("2026-08-31");
    expect(parsed.statementBalanceCents).toBe(243109);
  });

  it("classifies payments (even without a printed minus), purchases, refunds, interest", () => {
    const parsed = parseAppleCardStatementText(PDF_TEXT);
    const payment = parsed.rows.find((r) => r.type === "payment");
    expect(payment).toBeDefined();
    expect(payment!.amountCents).toBe(-150000); // inflow despite "$1,500.00"

    const purchases = parsed.rows.filter((r) => r.type === "purchase");
    expect(purchases.map((p) => p.amountCents)).toEqual([4999, 8421, 5480]);

    const refund = parsed.rows.find((r) => r.type === "credit");
    expect(refund!.amountCents).toBe(-6250);

    const interest = parsed.rows.find((r) => r.type === "interest");
    expect(interest!.amountCents).toBe(1240);
  });

  it("joins merchants wrapped across multiple lines", () => {
    const parsed = parseAppleCardStatementText(PDF_TEXT);
    const wrapped = parsed.rows.find((r) =>
      r.description.includes("OVERSEAS MERCHANT"),
    );
    expect(wrapped).toBeDefined();
    expect(wrapped!.amountCents).toBe(5480);
    expect(wrapped!.description).toContain("KOWLOON HK");
  });

  it("never imports installment-plan origination rows", () => {
    const parsed = parseAppleCardStatementText(PDF_TEXT);
    expect(parsed.rows.some((r) => r.date === "2026-05-19")).toBe(false);
    expect(parsed.rows.some((r) => r.amountCents === 129900)).toBe(false);
  });

  it("counts unparseable transaction-like lines instead of inventing data", () => {
    const parsed = parseAppleCardStatementText(PDF_TEXT);
    expect(parsed.uncertainCount).toBe(1); // the GARBLED line
    expect(
      parsed.rows.some((r) => r.description.includes("GARBLED")),
    ).toBe(false);
  });

  it("skips section totals and column-header lines", () => {
    const parsed = parseAppleCardStatementText(PDF_TEXT);
    expect(parsed.rows.some((r) => /^total/i.test(r.description))).toBe(false);
    expect(parsed.rows.some((r) => /^date description/i.test(r.description))).toBe(false);
  });

  it("does not classify merchants containing 'fee'-like words as fees", () => {
    const parsed = parseAppleCardStatementText(
      "Statement\nAug 1 — Aug 31, 2026\nTransactions\n08/02/2026 TOFFEE SHOP FEE FI FO 1% $0.05 $5.00\n",
    );
    expect(parsed.rows[0].type).toBe("purchase");
  });
});

describe("stable import identifiers", () => {
  it("generates identical ids for identical rows across parses", () => {
    const a = toProviderTransactions("acc_1", parseAppleCardCsv(CSV).rows);
    const b = toProviderTransactions("acc_1", parseAppleCardCsv(CSV).rows);
    expect(a.map((t) => t.providerTransactionId)).toEqual(
      b.map((t) => t.providerTransactionId),
    );
  });

  it("distinguishes identical same-day transactions within one file", () => {
    const pts = toProviderTransactions("acc_1", parseAppleCardCsv(CSV).rows);
    const coffee = pts.filter((t) => t.rawDescription.includes("BLUE BOTTLE"));
    expect(coffee).toHaveLength(2);
    expect(coffee[0].providerTransactionId).not.toBe(
      coffee[1].providerTransactionId,
    );
  });

  it("scopes ids to the account", () => {
    const row = parseAppleCardCsv(CSV).rows[0];
    expect(appleTransactionId("acc_1", row, 0)).not.toBe(
      appleTransactionId("acc_2", row, 0),
    );
  });

  it("maps payments to the credit-card-payment provider category", () => {
    const pts = toProviderTransactions("acc_1", parseAppleCardCsv(CSV).rows);
    const payment = pts.find((t) => t.amount < -1000)!;
    expect(payment.providerCategoryPrimary).toBe("LOAN_PAYMENTS");
    const grocery = pts.find((t) => t.rawDescription.includes("WHOLE FOODS"))!;
    expect(grocery.providerCategoryPrimary).toBe("GROCERIES");
  });
});
