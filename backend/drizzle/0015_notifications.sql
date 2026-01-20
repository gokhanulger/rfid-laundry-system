-- Notification channel enum
CREATE TYPE notification_channel AS ENUM ('whatsapp', 'sms', 'email', 'webhook');

-- Notification event type enum
CREATE TYPE notification_event AS ENUM (
  'delivery_created',
  'delivery_packaged',
  'delivery_picked_up',
  'delivery_delivered',
  'pickup_created',
  'pickup_received',
  'daily_summary',
  'alert_new'
);

-- Notification status enum
CREATE TYPE notification_status AS ENUM ('pending', 'sent', 'failed', 'delivered');

-- Notification settings per tenant
CREATE TABLE notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel notification_channel NOT NULL,
  is_enabled BOOLEAN DEFAULT true,
  -- WhatsApp Business API settings
  whatsapp_phone_id TEXT, -- Meta Phone Number ID
  whatsapp_access_token TEXT, -- Meta API Access Token
  whatsapp_recipient TEXT, -- Default recipient phone number
  -- Webhook settings
  webhook_url TEXT,
  webhook_secret TEXT,
  -- General settings
  events notification_event[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
  UNIQUE(tenant_id, channel)
);

-- Notification templates
CREATE TABLE notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  event notification_event NOT NULL,
  channel notification_channel NOT NULL,
  subject TEXT, -- For email
  content TEXT NOT NULL, -- Template with placeholders like {{hotel_name}}, {{item_count}}
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
  UNIQUE(event, channel)
);

-- Notification logs
CREATE TABLE notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  channel notification_channel NOT NULL,
  event notification_event NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT,
  content TEXT NOT NULL,
  status notification_status DEFAULT 'pending',
  external_id TEXT, -- ID from WhatsApp/SMS provider
  error_message TEXT,
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Add WhatsApp settings to tenants table
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS notification_enabled BOOLEAN DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS notification_phone TEXT;

-- Insert default templates
INSERT INTO notification_templates (name, event, channel, content) VALUES
  ('Teslimat Olusturuldu', 'delivery_created', 'whatsapp', 'Sayin {{hotel_name}}, {{item_count}} adet temiz camasiriniz teslimata hazir. Barkod: {{barcode}}'),
  ('Teslimat Paketlendi', 'delivery_packaged', 'whatsapp', 'Sayin {{hotel_name}}, {{package_count}} paket camasiriniz paketlendi ve teslimata hazir.'),
  ('Teslimat Yola Cikti', 'delivery_picked_up', 'whatsapp', 'Sayin {{hotel_name}}, camasirlariniz yola cikti. Surucu: {{driver_name}}'),
  ('Teslimat Tamamlandi', 'delivery_delivered', 'whatsapp', 'Sayin {{hotel_name}}, {{item_count}} adet temiz camasiriniz teslim edildi. Barkod: {{barcode}}'),
  ('Toplama Olusturuldu', 'pickup_created', 'whatsapp', 'Sayin {{hotel_name}}, kirli camasir toplama islemi olusturuldu. Cuval: {{bag_code}}'),
  ('Toplama Tamamlandi', 'pickup_received', 'whatsapp', 'Sayin {{hotel_name}}, {{item_count}} adet kirli camasiriniz camasirhanede teslim alindi.'),
  ('Gunluk Ozet', 'daily_summary', 'whatsapp', 'Sayin {{hotel_name}}, Gunluk Ozet:\nOtelde: {{at_hotel}} adet\nCamasirhanede: {{at_laundry}} adet\nYolda: {{in_transit}} adet')
ON CONFLICT (event, channel) DO NOTHING;

-- Create indexes
CREATE INDEX idx_notification_settings_tenant ON notification_settings(tenant_id);
CREATE INDEX idx_notification_logs_tenant ON notification_logs(tenant_id);
CREATE INDEX idx_notification_logs_status ON notification_logs(status);
CREATE INDEX idx_notification_logs_created ON notification_logs(created_at);
