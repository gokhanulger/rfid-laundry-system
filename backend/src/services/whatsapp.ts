/**
 * WhatsApp gönderici — Meta WhatsApp Cloud API (Graph API) üzerinden.
 *
 * Gerekli env (Railway):
 *   WHATSAPP_PHONE_ID            Meta WhatsApp telefon numarası ID'si (zorunlu)
 *   WHATSAPP_ACCESS_TOKEN        Kalıcı (system user) access token (zorunlu)
 *   WHATSAPP_API_VERSION         Graph API sürümü (varsayılan: v21.0)
 *   WHATSAPP_TEMPLATE_DELIVERY   Temiz teslim sablon adi (vars: teslimat_bildirimi)
 *   WHATSAPP_TEMPLATE_PICKUP     Kirli teslim alma sablon adi (vars: teslim_alma_bildirimi)
 *   WHATSAPP_TEMPLATE_LANG       Şablon dil kodu (vars: tr)
 *   WHATSAPP_USE_TEMPLATE        'false' ise serbest metin (sadece 24sa penceresi / test)
 *   WHATSAPP_WEBHOOK_VERIFY_TOKEN  Meta webhook doğrulama token'ı (notifications.ts'de kullanılır)
 *
 * ÖNEMLİ: İşletmenin başlattığı (24 saatlik pencere dışı) mesajlar için Meta
 * yalnızca ONAYLI ŞABLON mesajlarına izin verir. Sablonlar Meta Business Manager'da
 * onaylatılmalıdır.
 *
 * Onerilen sablon govdesi (4 parametre):
 *   delivery: "Sayın {{1}}, çamaşır teslimatınız tamamlanmıştır. İrsaliye No: {{2}} - Toplam: {{3}} adet - Tarih: {{4}}. İrsaliye PDF'i e-posta adresinize gönderilmiştir."
 *   pickup:   "Sayın {{1}}, kirli ürünleriniz teslim alınmıştır. İrsaliye/Çuval No: {{2}} - Adet: {{3}} - Tarih: {{4}}. İrsaliye PDF'i e-posta adresinize gönderilmiştir."
 *
 * Tüm gönderimler notification_logs tablosuna kaydedilir (admin mesajlar sayfasında görünür).
 */

import { db } from '../db';
import { notificationLogs } from '../db/schema';

export interface DeliveryWhatsAppParams {
  tenantId: string;
  toPhone: string;
  hotelName: string;
  waybillNumber: string;
  totalItems: number;
  date: string;
}

export interface PickupWhatsAppParams {
  tenantId: string;
  toPhone: string;
  hotelName: string;
  bagCode: string;
  totalItems: number;
  date: string;
}

/**
 * Türkiye telefonunu Meta'nın beklediği formata çevirir (basinda + olmadan, sadece rakam).
 * Örnek: "0532 123 45 67" -> "905321234567"
 */
export function normalizeTurkishPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = '90' + digits.slice(1);
  else if (digits.length === 10) digits = '90' + digits;
  if (digits.length < 11) return null;
  return digits;
}

interface MetaConfig {
  phoneId: string;
  accessToken: string;
  apiVersion: string;
  templateDelivery: string;
  templatePickup: string;
  templateLang: string;
  useTemplate: boolean;
}

function getConfig(): MetaConfig | null {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !accessToken) return null;
  return {
    phoneId,
    accessToken,
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
    templateDelivery: process.env.WHATSAPP_TEMPLATE_DELIVERY || 'teslimat_bildirimi',
    templatePickup: process.env.WHATSAPP_TEMPLATE_PICKUP || 'teslim_alma_bildirimi',
    templateLang: process.env.WHATSAPP_TEMPLATE_LANG || 'tr',
    useTemplate: (process.env.WHATSAPP_USE_TEMPLATE || 'true').toLowerCase() !== 'false',
  };
}

interface SendResult {
  success: boolean;
  externalId?: string;
  error?: string;
}

async function metaSend(
  cfg: MetaConfig,
  to: string,
  freeformBody: string,
  templateName: string,
  templateParams: string[]
): Promise<SendResult> {
  const url = `https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneId}/messages`;
  let body: Record<string, unknown>;
  if (cfg.useTemplate) {
    body = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: cfg.templateLang },
        components: [
          {
            type: 'body',
            parameters: templateParams.map((p) => ({ type: 'text', text: p })),
          },
        ],
      },
    };
  } else {
    body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: freeformBody },
    };
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as any;
    if (!response.ok) {
      const errMsg = result?.error?.message || `HTTP ${response.status}`;
      console.error('Meta WhatsApp gönderim hatası:', errMsg);
      return { success: false, error: errMsg };
    }
    return { success: true, externalId: result?.messages?.[0]?.id as string | undefined };
  } catch (err: any) {
    console.error('Meta WhatsApp istisnası:', err);
    return { success: false, error: err?.message || 'Unknown error' };
  }
}

async function logNotification(
  tenantId: string,
  event: 'delivery_delivered' | 'pickup_received',
  recipient: string,
  content: string,
  result: SendResult
): Promise<void> {
  try {
    await db.insert(notificationLogs).values({
      tenantId,
      channel: 'whatsapp',
      event,
      recipient,
      subject: null,
      content,
      status: result.success ? 'sent' : 'failed',
      externalId: result.externalId || null,
      errorMessage: result.error || null,
      sentAt: result.success ? new Date() : null,
    });
  } catch (logErr) {
    console.error('notification_logs yazılamadı:', logErr);
  }
}

export async function sendDeliveryWhatsApp(params: DeliveryWhatsAppParams): Promise<boolean> {
  const fallbackBody =
    `Sayın ${params.hotelName}, çamaşır teslimatınız tamamlanmıştır.\n` +
    `İrsaliye No: ${params.waybillNumber}\n` +
    `Toplam: ${params.totalItems} adet\n` +
    `Tarih: ${params.date}\n` +
    `İrsaliye PDF'i e-posta adresinize gönderilmiştir.`;

  const to = normalizeTurkishPhone(params.toPhone);
  if (!to) {
    console.warn(`WhatsApp: geçersiz telefon "${params.toPhone}" - mesaj gönderilmedi`);
    await logNotification(params.tenantId, 'delivery_delivered', params.toPhone || '', fallbackBody, {
      success: false,
      error: 'Geçersiz telefon numarası',
    });
    return false;
  }
  const cfg = getConfig();
  if (!cfg) {
    console.warn('Meta WhatsApp yapılandırılmamış - mesaj gönderilmedi');
    await logNotification(params.tenantId, 'delivery_delivered', to, fallbackBody, {
      success: false,
      error: 'Meta WhatsApp env yapılandırılmamış',
    });
    return false;
  }

  const result = await metaSend(cfg, to, fallbackBody, cfg.templateDelivery, [
    params.hotelName,
    params.waybillNumber,
    String(params.totalItems),
    params.date,
  ]);
  await logNotification(params.tenantId, 'delivery_delivered', to, fallbackBody, result);
  if (result.success) {
    console.log(`Meta WhatsApp (temiz teslim) gönderildi -> ${to} (msg id: ${result.externalId || 'n/a'})`);
  }
  return result.success;
}

export async function sendPickupWhatsApp(params: PickupWhatsAppParams): Promise<boolean> {
  const fallbackBody =
    `Sayın ${params.hotelName}, kirli ürünleriniz teslim alınmıştır.\n` +
    `İrsaliye / Çuval No: ${params.bagCode}\n` +
    `Teslim Alınan: ${params.totalItems} adet\n` +
    `Tarih: ${params.date}\n` +
    `İrsaliye PDF'i e-posta adresinize gönderilmiştir.`;

  const to = normalizeTurkishPhone(params.toPhone);
  if (!to) {
    console.warn(`WhatsApp: geçersiz telefon "${params.toPhone}" - mesaj gönderilmedi`);
    await logNotification(params.tenantId, 'pickup_received', params.toPhone || '', fallbackBody, {
      success: false,
      error: 'Geçersiz telefon numarası',
    });
    return false;
  }
  const cfg = getConfig();
  if (!cfg) {
    console.warn('Meta WhatsApp yapılandırılmamış - mesaj gönderilmedi');
    await logNotification(params.tenantId, 'pickup_received', to, fallbackBody, {
      success: false,
      error: 'Meta WhatsApp env yapılandırılmamış',
    });
    return false;
  }

  const result = await metaSend(cfg, to, fallbackBody, cfg.templatePickup, [
    params.hotelName,
    params.bagCode,
    String(params.totalItems),
    params.date,
  ]);
  await logNotification(params.tenantId, 'pickup_received', to, fallbackBody, result);
  if (result.success) {
    console.log(`Meta WhatsApp (kirli teslim alma) gönderildi -> ${to} (msg id: ${result.externalId || 'n/a'})`);
  }
  return result.success;
}
