CREATE TABLE IF NOT EXISTS "tenant_pricing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_type_id" uuid NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "tenant_pricing" ADD CONSTRAINT "tenant_pricing_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "tenant_pricing" ADD CONSTRAINT "tenant_pricing_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Unique constraint: one price per tenant per item type
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_pricing_tenant_item_idx" ON "tenant_pricing" ("tenant_id", "item_type_id");
