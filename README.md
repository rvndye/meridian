# Meridian — Personal Finance Dashboard

A private, self-hosted personal-finance dashboard. Connects to your banks and
credit cards through Plaid, imports and categorizes transactions, detects
transfers and subscriptions, tracks income and net worth, and answers questions
about your money with an AI assistant that only reports numbers computed from
your actual data.

Built with Next.js 15, TypeScript, Tailwind CSS, Recharts, Drizzle ORM, and
PostgreSQL. No subscription, no ads, no tracking — your data lives in your own
database.

## Features

- **Dashboard** — net worth (assets, liabilities, monthly/yearly change), cash
  flow, top spending categories, recent activity
- **Accounts** — every connected account with balances, limits, sync status
- **Transactions** — searchable/filterable/sortable table with a detail panel;
  edit category, merchant name, and notes (edits persist and survive re-syncs)
- **Categorization** — provider categories are normalized to a fixed taxonomy;
  your recategorizations become merchant rules that apply retroactively and to
  future syncs; user edits always win
- **Transfer detection** — transfers between your own accounts and credit-card
  payments count as neither income nor spending (two-sided matching plus
  description heuristics)
- **Spending / Income** — category and merchant breakdowns, period comparison,
  1/3/6/12-month and custom ranges
- **Recurring** — automatic detection of subscriptions, bills, and recurring
  income with cadence, next-expected date, and annualized cost
- **Net worth** — history from balance snapshots, per-account breakdown, credit
  card "charged vs paid" view
- **Sync** — incremental cursor-based sync, stable-ID dedup, pending→posted
  replacement in place, sync event log, "Sync now"
- **AI assistant** — Claude with a fixed set of query tools over the analytics
  layer; all arithmetic happens in code, never in the model
- **Apple Card import** — Apple Card isn't on Plaid; import monthly statement
  PDFs or Wallet CSV exports instead. Preview before committing, stable
  dedup ids (re-uploads never duplicate), and imported transactions flow
  through the same categorization/rules/transfer-detection as everything
  else. Documents are parsed in memory and never stored.
- **Assets** — track property, vehicles, and other holdings with an
  append-only valuation history, manual/automated/hybrid valuation methods
  (manual override always wins in hybrid), value-over-time charts, optional
  mortgage linkage for equity, and full net-worth integration
- **Security** — single-user passphrase auth (encrypted session cookie), Plaid
  tokens encrypted at rest (AES-256-GCM), zod-validated APIs, parameterized
  queries throughout

## Quick start (zero configuration)

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no configuration the app runs on an embedded
Postgres (PGlite, stored in `.data/`) and auto-seeds a deterministic **demo
dataset** so every feature is explorable immediately. Nothing external is
contacted.

## Setup

### 1. Environment variables

```bash
cp .env.example .env.local
```

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | deploy only | Postgres connection string (Supabase works). Unset = embedded PGlite in `.data/` |
| `DEMO_DATA` | no | `false` disables demo auto-seeding (set before connecting real accounts) |
| `APP_PASSWORD` | before deploying | Passphrase that locks the dashboard. Unset = auth disabled (local dev only) |
| `SESSION_SECRET` | with `APP_PASSWORD` | Cookie sealing secret — `openssl rand -base64 32` |
| `APP_ENCRYPTION_KEY` | for Plaid | Encrypts access tokens at rest — `openssl rand -hex 32` |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` | for bank sync | From the Plaid dashboard (sandbox keys are free) |
| `PLAID_ENV` | no | `sandbox` (default), `development`, or `production` |
| `PLAID_REDIRECT_URI` | for OAuth banks | e.g. `http://localhost:3000/plaid-oauth`; must exactly match an allowed redirect URI in the Plaid dashboard |
| `ANTHROPIC_API_KEY` | for AI assistant | The dashboard works fully without it |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-opus-5` |
| `RENTCAST_API_KEY` | no | Enables automated property estimates on the Assets page; manual valuations always work without it |

### 2. Database

- **Local development**: nothing to do — PGlite migrates and seeds itself on
  first run.
- **Supabase/Postgres**: create a project, copy the connection string into
  `DATABASE_URL`, then run migrations:

```bash
npm run db:migrate
```

Other database commands:

```bash
npm run db:seed      # seed demo data into an empty database
npm run db:reset     # DROP everything, re-migrate, re-seed (destructive)
npm run db:generate  # regenerate SQL migrations after editing src/db/schema.ts
```

### 3. Plaid sandbox

1. Create a free account at https://dashboard.plaid.com and copy the **sandbox**
   client ID and secret into `.env.local`, plus an `APP_ENCRYPTION_KEY`.
2. Set `DEMO_DATA=false` and run `npm run db:reset` for a clean database
   (or keep the demo data alongside — they coexist).
3. Restart, open **Accounts → Connect account**, and pick any institution in
   the Plaid Link window. Sandbox credentials are `user_good` / `pass_good`.
4. The initial import runs immediately; use **Sync now** on the dashboard for
   incremental updates afterwards.

Real institutions require Plaid production access (their approval process +
pay-as-you-go pricing). The app is identical in either mode — only the keys
change.

#### OAuth institutions (Chase, Capital One, …)

Many large banks authenticate on their own site instead of inside the Link
window. That flow needs a registered redirect back into Meridian:

1. In the Plaid dashboard, open **Developers → API → Allowed redirect URIs**
   and add `http://localhost:3000/plaid-oauth` (use your `https://` domain in
   production — Plaid requires HTTPS outside localhost).
2. Set `PLAID_REDIRECT_URI` in `.env.local` to that exact value and restart.
3. Connect as usual. After you log in at the bank, you land on
   `/plaid-oauth`, which resumes Link automatically and finishes the import.

To try it in sandbox, search for **Platypus OAuth Bank** in the Link window —
it simulates the full redirect round-trip. If `PLAID_REDIRECT_URI` is unset,
non-OAuth institutions keep working; OAuth ones won't appear.

### 4. Tests

```bash
npm test
```

The suite covers the financial-accuracy invariants: transfer pairing,
credit-card payment exclusion, refunds netting against categories, pending
transactions, pending→posted replacement, sync dedup, user overrides surviving
re-syncs, merchant rules (retroactive + future), date boundaries, monthly
totals, net-worth math, and recurring detection. Fixtures are entirely fake —
no real financial data is used anywhere.

```bash
npm run lint
npx tsc --noEmit
```

### 5. Deploy (Vercel + Supabase)

1. Push the repo to GitHub and import it into Vercel.
2. Set the environment variables from the table above — at minimum
   `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`, `APP_ENCRYPTION_KEY`,
   `DEMO_DATA=false`, and your Plaid keys.
3. Run `DATABASE_URL=... npm run db:migrate` once against the production
   database.
4. Deploy. The middleware enforces login on every page and API route.

## Architecture

```
src/
  app/                 pages (server components) + API routes
  components/          UI + chart components
  db/                  Drizzle schema, client (PGlite/Postgres), migrations, seed
  lib/
    domain/            types, category taxonomy, PURE analytics functions
    providers/         FinancialDataProvider interface + PlaidFinancialDataProvider
    ai/                assistant tool definitions
    repo.ts            the only module that touches the database
    sync.ts            sync engine (dedup, pending→posted, transfer pass)
    auth.ts, crypto.ts single-user auth + token encryption
tests/                 vitest suite with fake fixtures
drizzle/               generated SQL migrations
```

Key design decisions:

- **All financial math lives in `src/lib/domain/analytics.ts`** as pure
  functions over transaction arrays. The dashboard, the AI tools, and the tests
  all call the same code, so a number shown anywhere is computed exactly one
  way.
- **Provider abstraction** — the app depends on the `FinancialDataProvider`
  interface, not on Plaid. `PlaidFinancialDataProvider` is one implementation;
  another aggregator can be added without touching the rest of the app.
- **Original provider data is never destroyed** — the raw payload is kept in
  `transactions.provider_data`, the provider's category in
  `provider_category`, and the original description in `raw_description`.
- **Money is stored as integer cents** in the database; the repository converts
  at the boundary. Amount sign follows Plaid: positive = money out.
- **Categorization precedence**: user override > merchant rule > provider
  mapping > default. Sync updates never overwrite a user's category, merchant,
  or notes.

## Privacy: exactly which third parties see your data

| Party | What it receives | Why | Optional? |
|---|---|---|---|
| **Plaid** | Your bank credentials (entered in Plaid's own widget — this app never sees them); account and transaction data from your institutions | It is the aggregation provider that connects to banks | Yes — without keys the app runs on demo/manual data |
| **Anthropic** | The questions you type to the assistant plus the numeric summaries returned by the query tools (balances, category totals, matching transactions) | To generate assistant answers | Yes — without a key the assistant is disabled |
| **Your database host** (e.g. Supabase) | Everything the app stores | It is your database | Yes — local PGlite keeps all data on your machine |
| **Vercel** (if deployed there) | Traffic passing through your deployment | Hosting | Yes — run locally instead |

There is no analytics, no tracking, no advertising, and no other data sharing.
Bank passwords are never stored or seen by this app; Plaid access tokens are
encrypted at rest; tokens and account numbers are never logged.

## Roadmap ideas

Budgeting, goals, investment holdings, forecasting, anomaly alerts, AI monthly
reviews, CSV import, multi-currency.
