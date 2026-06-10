-- Kirli Teslim Beyani (Dirty Declaration)
-- Otel sahibi portaldan kirli urun tip+adetlerini bildirir; camasirhane (admin liste + utucu) gorur,
-- utucu o oteli isleyip etiketi basinca beyan 'processed' olur (Beklemede -> Islendi).

DO $$ BEGIN
  CREATE TYPE "dirty_declaration_status" AS ENUM('pending', 'processed');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dirty_declarations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "status" "dirty_declaration_status" DEFAULT 'pending' NOT NULL,
  "items" text NOT NULL,
  "notes" text,
  "created_by" uuid,
  "processed_by" uuid,
  "processed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "dirty_declarations" ADD CONSTRAINT "dirty_declarations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "dirty_declarations" ADD CONSTRAINT "dirty_declarations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "dirty_declarations" ADD CONSTRAINT "dirty_declarations_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dirty_declarations_tenant_status" ON "dirty_declarations" ("tenant_id", "status");
