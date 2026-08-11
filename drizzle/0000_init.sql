CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text,
	"provider_account_id" text,
	"institution_name" text NOT NULL,
	"name" text NOT NULL,
	"official_name" text,
	"type" text NOT NULL,
	"mask" text,
	"current_balance_cents" integer DEFAULT 0 NOT NULL,
	"available_balance_cents" integer,
	"credit_limit_cents" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "balance_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"date" text NOT NULL,
	"balance_cents" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_pattern" text NOT NULL,
	"category_id" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_item_id" text,
	"institution_id" text,
	"access_token_encrypted" text,
	"sync_cursor" text,
	"status" text DEFAULT 'active' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "institutions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider_institution_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant" text NOT NULL,
	"category_id" text NOT NULL,
	"account_id" text NOT NULL,
	"cadence" text NOT NULL,
	"typical_amount_cents" integer NOT NULL,
	"last_date" text NOT NULL,
	"next_expected_date" text NOT NULL,
	"annualized_cost_cents" integer NOT NULL,
	"occurrences" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_events" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"modified" integer DEFAULT 0 NOT NULL,
	"removed" integer DEFAULT 0 NOT NULL,
	"message" text
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_transaction_id" text,
	"pending_provider_transaction_id" text,
	"date" text NOT NULL,
	"merchant" text NOT NULL,
	"raw_description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"category_id" text DEFAULT 'other' NOT NULL,
	"category_source" text DEFAULT 'default' NOT NULL,
	"provider_category" text,
	"provider_data" jsonb,
	"is_transfer" boolean DEFAULT false NOT NULL,
	"transfer_pair_id" text,
	"notes" text,
	"removed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_connection_id_financial_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."financial_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_connections" ADD CONSTRAINT "financial_connections_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "acct_provider_idx" ON "accounts" USING btree ("connection_id","provider_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "snap_account_date_idx" ON "balance_snapshots" USING btree ("account_id","date");--> statement-breakpoint
CREATE INDEX "snap_date_idx" ON "balance_snapshots" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_pattern_idx" ON "category_rules" USING btree ("merchant_pattern");--> statement-breakpoint
CREATE UNIQUE INDEX "fc_provider_item_idx" ON "financial_connections" USING btree ("provider","provider_item_id");--> statement-breakpoint
CREATE INDEX "sync_started_idx" ON "sync_events" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "txn_provider_idx" ON "transactions" USING btree ("provider_transaction_id");--> statement-breakpoint
CREATE INDEX "txn_date_idx" ON "transactions" USING btree ("date");--> statement-breakpoint
CREATE INDEX "txn_account_date_idx" ON "transactions" USING btree ("account_id","date");--> statement-breakpoint
CREATE INDEX "txn_category_idx" ON "transactions" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "txn_merchant_idx" ON "transactions" USING btree ("merchant");