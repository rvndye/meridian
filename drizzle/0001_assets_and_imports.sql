CREATE TABLE "asset_valuations" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"valuation_date" text NOT NULL,
	"value_cents" integer NOT NULL,
	"value_low_cents" integer,
	"value_high_cents" integer,
	"source" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"asset_type" text NOT NULL,
	"description" text,
	"address" text,
	"purchase_date" text,
	"purchase_price_cents" integer,
	"current_value_cents" integer DEFAULT 0 NOT NULL,
	"valuation_method" text DEFAULT 'manual' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"details" jsonb,
	"liability_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statement_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"source" text NOT NULL,
	"file_hash" text NOT NULL,
	"period_start" text,
	"period_end" text,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"uncertain_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_valuations" ADD CONSTRAINT "asset_valuations_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_liability_account_id_accounts_id_fk" FOREIGN KEY ("liability_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "val_asset_date_idx" ON "asset_valuations" USING btree ("asset_id","valuation_date");--> statement-breakpoint
CREATE UNIQUE INDEX "import_account_hash_idx" ON "statement_imports" USING btree ("account_id","file_hash");