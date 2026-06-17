-- Urun listesi/ozet sorgularini hizlandirmak icin index'ler.
-- /items?tenantId=... ve /items/summary/by-tenant (GROUP BY tenant_id) tam tablo
-- taramasi yapiyordu; tenant_id ve status uzerinde index ile hizlanir.
CREATE INDEX IF NOT EXISTS items_tenant_id_idx ON items (tenant_id);
CREATE INDEX IF NOT EXISTS items_status_idx ON items (status);
CREATE INDEX IF NOT EXISTS items_tenant_status_idx ON items (tenant_id, status);
