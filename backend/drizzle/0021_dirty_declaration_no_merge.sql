-- Kirli irsaliye: sirali numara (1,2,3...) + birlestirme (merge) destegi

-- Sirali numara icin DB sequence
CREATE SEQUENCE IF NOT EXISTS "dirty_declaration_no_seq" START 1;--> statement-breakpoint

ALTER TABLE "dirty_declarations" ADD COLUMN IF NOT EXISTS "declaration_no" integer;--> statement-breakpoint
ALTER TABLE "dirty_declarations" ADD COLUMN IF NOT EXISTS "merged_into_id" uuid;--> statement-breakpoint

-- Mevcut kayitlara created_at sirasina gore numara ver
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at) AS rn
  FROM "dirty_declarations"
  WHERE declaration_no IS NULL
)
UPDATE "dirty_declarations" d
SET declaration_no = o.rn
FROM ordered o
WHERE d.id = o.id;--> statement-breakpoint

-- Sequence'i mevcut maksimumun bir sonrasina ayarla (is_called=false -> sonraki nextval bu deger olur)
SELECT setval('dirty_declaration_no_seq', (SELECT COALESCE(MAX(declaration_no), 0) FROM "dirty_declarations") + 1, false);--> statement-breakpoint

-- Yeni kayitlar otomatik sirali numara alir
ALTER TABLE "dirty_declarations" ALTER COLUMN "declaration_no" SET DEFAULT nextval('dirty_declaration_no_seq');
