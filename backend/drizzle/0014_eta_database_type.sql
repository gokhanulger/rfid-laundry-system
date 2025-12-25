-- Add eta_database_type enum and column
DO $$ BEGIN
    CREATE TYPE "public"."eta_database_type" AS ENUM('official', 'unofficial');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add new column with default value
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "eta_database_type" "eta_database_type" DEFAULT 'official';

-- Migrate existing data from eta_database_name to eta_database_type
UPDATE "tenants"
SET "eta_database_type" = CASE
    WHEN LOWER(COALESCE("eta_database_name", '')) LIKE '%teklif%' THEN 'unofficial'::eta_database_type
    WHEN LOWER(COALESCE("eta_database_name", '')) LIKE '%gayri%' THEN 'unofficial'::eta_database_type
    ELSE 'official'::eta_database_type
END
WHERE "eta_database_type" IS NULL OR "eta_database_name" IS NOT NULL;

-- Drop old column
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "eta_database_name";
