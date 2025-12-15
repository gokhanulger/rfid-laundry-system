CREATE TYPE "public"."waybill_status" AS ENUM('created', 'printed', 'picked_up', 'delivered');--> statement-breakpoint
CREATE TABLE "waybill_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waybill_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waybills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"waybill_number" text NOT NULL,
	"status" "waybill_status" DEFAULT 'created' NOT NULL,
	"package_count" integer DEFAULT 0 NOT NULL,
	"bag_count" integer DEFAULT 0 NOT NULL,
	"total_items" integer DEFAULT 0 NOT NULL,
	"item_summary" text,
	"printed_at" timestamp,
	"printed_by" uuid,
	"picked_up_at" timestamp,
	"delivered_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "waybills_waybill_number_unique" UNIQUE("waybill_number")
);
--> statement-breakpoint
ALTER TABLE "waybill_deliveries" ADD CONSTRAINT "waybill_deliveries_waybill_id_waybills_id_fk" FOREIGN KEY ("waybill_id") REFERENCES "public"."waybills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybill_deliveries" ADD CONSTRAINT "waybill_deliveries_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybills" ADD CONSTRAINT "waybills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybills" ADD CONSTRAINT "waybills_printed_by_users_id_fk" FOREIGN KEY ("printed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;