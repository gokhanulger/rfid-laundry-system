-- Kirli Irsaliye urun listesi (admin yonetir, otel formunda gorunur)
CREATE TABLE IF NOT EXISTS "dirty_declaration_products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Baslangic listesi: KAR BEYAZ TESLIM FISI (KIRLI) standart urunleri.
-- Sadece tablo bos ise eklenir (tekrar calismaya karsi guvenli).
INSERT INTO "dirty_declaration_products" ("name", "sort_order")
SELECT v.name, v.sort_order FROM (VALUES
  ('ÇARŞAF', 10),
  ('YASTIK KILIFI', 20),
  ('NEVRESİM', 30),
  ('BANYO HAVLU', 40),
  ('YÜZ HAVLU', 50),
  ('PASPAS HAVLU', 60),
  ('PİKE', 70),
  ('ALEZ', 80),
  ('BORNOZ', 90),
  ('MİFLON', 100),
  ('YATAK ÖRTÜSÜ', 110),
  ('YATAK ETEĞİ', 120),
  ('YORGAN', 130),
  ('BATTANİYE', 140),
  ('YASTIK', 150),
  ('KUMAŞ PERDE (M2)', 160),
  ('TÜL PERDE (M2)', 170),
  ('BANYO PERDE (M2)', 180),
  ('KİLİM (M2)', 190),
  ('TROL', 200),
  ('PEŞTEMAL', 210),
  ('BANYO HAVLUSU', 220),
  ('YÜZ HAVLU (SPA)', 230),
  ('MASA ÖRTÜSÜ', 240),
  ('MASA ÖRTÜSÜ (+2MT)', 250),
  ('RUNNER', 260),
  ('PEÇETE', 270),
  ('SANDALYE KILIFI', 280),
  ('PANTOLON', 290),
  ('ETEK', 300),
  ('GÖMLEK', 310),
  ('YELEK', 320),
  ('ÖNLÜK', 330),
  ('AŞÇI CEKET', 340),
  ('ŞORT', 350)
) AS v(name, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM "dirty_declaration_products");
