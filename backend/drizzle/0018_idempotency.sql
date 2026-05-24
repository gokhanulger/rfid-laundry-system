-- Idempotency keys (SYNC_V2 - Asama 2)
-- Mutating op'lari clientOpId ile dedup eder: offline kuyruk replay'leri, cift-tetikleme
-- ve ag retry'lari en fazla BIR KEZ calisir. Additive ve geriye-uyumlu (clientOpId
-- gondermeyen istekler hic etkilenmez). Geri donus: 0018_idempotency_ROLLBACK.sql
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "client_op_id" text PRIMARY KEY,
  "method" text NOT NULL,
  "path" text,
  "status_code" integer,
  "response_body" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_idempotency_created_at" ON "idempotency_keys" ("created_at");
