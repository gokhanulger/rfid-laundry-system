-- Gelen (inbound) WhatsApp mesajlarini ayni notification_logs tablosunda tutmak icin

-- 1) Yon kolonu: 'outbound' (sistem -> otel) / 'inbound' (otel -> sistem)
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'outbound';

-- 2) Gelen mesaj olay tipi
ALTER TYPE notification_event ADD VALUE IF NOT EXISTS 'inbound_message';

-- 3) Konusma threadlerini hizli cekmek icin index (tenant + zaman)
CREATE INDEX IF NOT EXISTS idx_notification_logs_tenant_created ON notification_logs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_logs_direction ON notification_logs(direction);
