-- Lekeli (stained) takibi
-- Utucu bir urunu LEKELI olarak isaretlediginde: isStained=true olur ve urun normal
-- akista kalir (yikanir/teslim edilir) ama otel portalindeki "Lekeli" listesinde gorunur.
-- isStained kolonu zaten mevcut; burada sadece zaman/neden kolonlarini ekliyoruz (iskarta ile simetrik).
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "stained_at" timestamp;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "stained_reason" text;
