-- ROLLBACK: 0025_items_stained
ALTER TABLE "items" DROP COLUMN IF EXISTS "stained_at";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN IF EXISTS "stained_reason";
