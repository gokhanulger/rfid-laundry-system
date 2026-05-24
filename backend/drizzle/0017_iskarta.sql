-- Iskarta (DISCORD) ozelligi
-- Utucu bir urunu iskartaya ayirdiginda: status='discarded' olur, aktif stoktan duser,
-- doluma/teslimata kapanir; etiket sistemde kalir, tekrar okutulunca uyari verir.

-- 'discarded' degerini item_status enum'una ekle.
-- NOT: ALTER TYPE ... ADD VALUE Postgres'te transaction icinde calistirilabilir (PG12+),
-- ancak yeni deger ayni transaction icinde KULLANILAMAZ. Bu migration yeni degeri sadece
-- ekliyor (kullanmiyor), bu yuzden guvenlidir.
ALTER TYPE "item_status" ADD VALUE IF NOT EXISTS 'discarded';--> statement-breakpoint

-- Iskarta takip kolonlari
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "discarded_at" timestamp;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "discarded_reason" text;
