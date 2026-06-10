-- ROLLBACK: 0021_dirty_declaration_no_merge
ALTER TABLE "dirty_declarations" ALTER COLUMN "declaration_no" DROP DEFAULT;
ALTER TABLE "dirty_declarations" DROP COLUMN IF EXISTS "declaration_no";
ALTER TABLE "dirty_declarations" DROP COLUMN IF EXISTS "merged_into_id";
DROP SEQUENCE IF EXISTS "dirty_declaration_no_seq";
