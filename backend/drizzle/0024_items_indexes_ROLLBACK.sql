-- Rollback: 0024_items_indexes
DROP INDEX IF EXISTS items_tenant_status_idx;
DROP INDEX IF EXISTS items_status_idx;
DROP INDEX IF EXISTS items_tenant_id_idx;
