-- ROLLBACK for 0018_idempotency
-- Geri donus: idempotency tablosunu kaldirir. Mutating endpoint'ler clientOpId'siz
-- istek gibi davranmaya devam eder (middleware fail-open). Ayrica drizzle journal'dan
-- 0018_idempotency girisini ve __drizzle_migrations'tan when=1772000000000 satirini sil.
DROP INDEX IF EXISTS "idx_idempotency_created_at";
DROP TABLE IF EXISTS "idempotency_keys";
