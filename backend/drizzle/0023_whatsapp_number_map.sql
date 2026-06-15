-- Otelin kayitli telefonundan FARKLI bir numaradan gelen WhatsApp mesajlarini
-- manuel olarak bir otele baglamak icin numara -> otel eslemesi.
-- Inbound webhook once bu tabloya bakar, yoksa tenant telefonuna gore eslesir.
CREATE TABLE IF NOT EXISTS whatsapp_number_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_last10 TEXT NOT NULL UNIQUE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);
