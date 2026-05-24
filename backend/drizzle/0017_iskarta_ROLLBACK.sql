-- ============================================================
-- 0017_iskarta GERI ALMA (rollback) - ELLE calistirilir, otomatik degil
-- ============================================================
-- ONEMLI: Bu migration TAMAMEN EK NITELIKLIDIR (additive):
--   - item_status enum'una 'discarded' degeri eklendi
--   - items tablosuna discarded_at, discarded_reason (nullable) kolonlari eklendi
-- Eski kod bu kolonlari/enum degerini HIC kullanmaz. Bu yuzden:
--
--   >>> GERI ALMAK ICIN GENELDE GEREK YOKTUR. <<<
--   Sadece BACKEND KODUNU eski surume dondurmek yeterlidir; DB'ye dokunmaya gerek yok.
--   Eklenen kolonlar/enum degeri eski kodu bozmaz (gorunmezdir).
--
-- Yine de DB'yi de temizlemek isterseniz asagidaki adimlari calistirin:

-- 1) (Varsa) iskartaya dusurulmus urunleri normale dondur:
UPDATE items
SET status = 'at_laundry', discarded_at = NULL, discarded_reason = NULL
WHERE status = 'discarded';

-- 2) Eklenen kolonlari kaldir:
ALTER TABLE items DROP COLUMN IF EXISTS discarded_at;
ALTER TABLE items DROP COLUMN IF EXISTS discarded_reason;

-- 3) NOT: PostgreSQL bir enum DEGERINI silmeyi desteklemez (ALTER TYPE ... DROP VALUE yoktur).
--    'discarded' degeri zararsizdir, birakin. Mutlaka silmek gerekiyorsa enum tipini
--    bastan olusturmak gerekir (riskli) - onerilmez.
