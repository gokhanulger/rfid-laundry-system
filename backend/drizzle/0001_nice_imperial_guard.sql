CREATE TYPE "public"."package_status" AS ENUM('created', 'scanned', 'picked_up');--> statement-breakpoint
CREATE TABLE "delivery_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"package_barcode" text NOT NULL,
	"sequence_number" integer NOT NULL,
	"status" "package_status" DEFAULT 'created' NOT NULL,
	"scanned_at" timestamp,
	"scanned_by" uuid,
	"picked_up_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_packages_package_barcode_unique" UNIQUE("package_barcode")
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "package_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_packages" ADD CONSTRAINT "delivery_packages_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_packages" ADD CONSTRAINT "delivery_packages_scanned_by_users_id_fk" FOREIGN KEY ("scanned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;