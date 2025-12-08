CREATE TYPE "public"."offline_sync_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scan_session_status" AS ENUM('in_progress', 'completed', 'synced', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."scan_session_type" AS ENUM('pickup', 'receive', 'process', 'clean', 'package', 'deliver');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('pending', 'synced', 'conflict', 'resolved');--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_uuid" text NOT NULL,
	"name" text NOT NULL,
	"user_id" uuid,
	"tenant_id" uuid,
	"last_sync_at" timestamp,
	"last_seen_at" timestamp,
	"app_version" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "devices_device_uuid_unique" UNIQUE("device_uuid")
);
--> statement-breakpoint
CREATE TABLE "offline_sync_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"session_data" text NOT NULL,
	"status" "offline_sync_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "scan_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfid_tag" text NOT NULL,
	"winning_session_id" uuid,
	"conflicting_session_id" uuid,
	"winning_device_id" uuid,
	"conflicting_device_id" uuid,
	"resolved_by" uuid,
	"resolution" text,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "scan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"rfid_tag" text NOT NULL,
	"item_id" uuid,
	"signal_strength" integer,
	"read_count" integer DEFAULT 1 NOT NULL,
	"sync_status" "sync_status" DEFAULT 'pending' NOT NULL,
	"scanned_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_type" "scan_session_type" NOT NULL,
	"status" "scan_session_status" DEFAULT 'in_progress' NOT NULL,
	"related_entity_type" text,
	"related_entity_id" uuid,
	"metadata" text,
	"item_count" integer DEFAULT 0 NOT NULL,
	"latitude" text,
	"longitude" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sync_queue" ADD CONSTRAINT "offline_sync_queue_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_conflicts" ADD CONSTRAINT "scan_conflicts_winning_session_id_scan_sessions_id_fk" FOREIGN KEY ("winning_session_id") REFERENCES "public"."scan_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_conflicts" ADD CONSTRAINT "scan_conflicts_conflicting_session_id_scan_sessions_id_fk" FOREIGN KEY ("conflicting_session_id") REFERENCES "public"."scan_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_conflicts" ADD CONSTRAINT "scan_conflicts_winning_device_id_devices_id_fk" FOREIGN KEY ("winning_device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_conflicts" ADD CONSTRAINT "scan_conflicts_conflicting_device_id_devices_id_fk" FOREIGN KEY ("conflicting_device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_conflicts" ADD CONSTRAINT "scan_conflicts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_session_id_scan_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."scan_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_sessions" ADD CONSTRAINT "scan_sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_sessions" ADD CONSTRAINT "scan_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_sessions" ADD CONSTRAINT "scan_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;