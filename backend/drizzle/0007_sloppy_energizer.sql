ALTER TABLE "tenants" ADD COLUMN "qr_code" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_qr_code_unique" UNIQUE("qr_code");