-- ROLLBACK 0022_notification_inbound
-- Not: enum'dan deger silinemez (Postgres ALTER TYPE ... DROP VALUE yok); 'inbound_message' kalir, zararsiz.
DROP INDEX IF EXISTS idx_notification_logs_direction;
DROP INDEX IF EXISTS idx_notification_logs_tenant_created;
ALTER TABLE notification_logs DROP COLUMN IF EXISTS direction;
