ALTER TABLE "deliveries" ADD COLUMN "eta_synced" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "eta_ref_no" text;