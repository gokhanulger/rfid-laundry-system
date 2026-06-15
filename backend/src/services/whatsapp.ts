/**
 * WhatsApp gönderici — Twilio Messaging API üzerinden.
 *
 * Gerekli env (Railway):
 *   TWILIO_ACCOUNT_SID            AC ile baslayan account SID (URL icin zorunlu)
 *   TWILIO_WHATSAPP_FROM          Gonderici (production: "whatsapp:+15054813444" gibi
 *                                  Twilio satin alinan numara) (zorunlu)
 *
 *   Auth (iki yoldan biri):
 *     A) TWILIO_AUTH_TOKEN        Klasik auth token
 *     B) TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET   (SK... ile baslar; tercih)
 *
 *   TWILIO_TEMPLATE_DELIVERY_SID  Temiz teslim icin onayli Content SID (HX...) (ops.)
 *   TWILIO_TEMPLATE_PICKUP_SID    Kirli teslim alma icin Content SID (ops.)
 *   TWILIO_STATUS_CALLBACK_URL    Mesaj durum guncellemesi gelecek URL (ops.)
 *
 * Template Content SID'leri set degilse SERBEST METIN gonderir (24 saatlik musteri
 * penceresinde calisir). Production isletmenin baslattigi bildirimleri icin onayli
 * template kullanmak gerekir.
 *
 * Tum gonderimler notification_logs tablosuna kaydedilir (admin sayfasinda gorulur).
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
 * Türkiye telefonunu E.164 ('+' ile baslar) formatina cevirir.
 * Twilio "whatsapp:+90..." formatini bekler; biz "+90..." donduruyoruz, caller "whatsapp:" prefix'ini ekler.
 */
export function normalizeTurkishPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = '90' + digits.slice(1);
  else if (digits.length === 10) digits = '90' + digits;
  if (digits.length < 11) return null;
  return '+' + digits;
}

interface TwilioConfig {
  accountSid: string;
  authUser: string; // Account SID (klasik) veya API Key SID (SK...)
  authPass: string; // Auth Token (klasik) veya API Key Secret
  from: string;
  templateDeliverySid?: string;
  templatePickupSid?: string;
  statusCallbackUrl?: string;
}

function getConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!accountSid || !from) return null;

  // API Key tercih (set ise), yoksa klasik Auth Token
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  let authUser: string, authPass: string;
  if (apiKeySid && apiKeySecret) {
    authUser = apiKeySid;
    authPass = apiKeySecret;
  } else if (authToken) {
    authUser = accountSid;
    authPass = authToken;
  } else {
    return null; // hicbir auth yontemi yok
  }

  return {
    accountSid,
    authUser,
    authPass,
    from,
    templateDeliverySid: process.env.TWILIO_TEMPLATE_DELIVERY_SID,
    templatePickupSid: process.env.TWILIO_TEMPLATE_PICKUP_SID,
    statusCallbackUrl: process.env.TWILIO_STATUS_CALLBACK_URL,
  };
}

interface SendResult {
  success: boolean;
  externalId?: string;
  error?: string;
}

async function twilioSend(
  cfg: TwilioConfig,
  toE164: string,
  body: string,
  contentSid?: string,
  contentVariables?: Record<string, string>
): Promise<SendResult> {
  const params = new URLSearchParams();
  params.append('From', cfg.from);
  params.append('To', `whatsapp:${toE164}`);
  if (contentSid) {
    params.append('ContentSid', contentSid);
    if (contentVariables) params.append('ContentVariables', JSON.stringify(contentVariables));
  } else {
    params.append('Body', body);
  }
  if (cfg.statusCallbackUrl) {
    params.append('StatusCallback', cfg.statusCallbackUrl);
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`;
  const auth = Buffer.from(`${cfg.authUser}:${cfg.authPass}`).toString('base64');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const result = (await response.json()) as any;
    if (!response.ok) {
      const errMsg = result?.message || result?.code || `HTTP ${response.status}`;
      console.error('Twilio WhatsApp gönderim hatası:', errMsg);
      return { success: false, error: String(errMsg) };
    }
    return { success: true, externalId: result.sid as string | undefined };
  } catch (err: any) {
    console.error('Twilio WhatsApp istisnası:', err);
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
    console.warn(`WhatsApp: gecersiz telefon "${params.toPhone}" - mesaj gönderilmedi`);
    await logNotification(params.tenantId, 'delivery_delivered', params.toPhone || '', fallbackBody, {
      success: false,
      error: 'Geçersiz telefon numarası',
    });
    return false;
  }
  const cfg = getConfig();
  if (!cfg) {
    console.warn('Twilio yapilandirilmamis - mesaj gönderilmedi');
    await logNotification(params.tenantId, 'delivery_delivered', to, fallbackBody, {
      success: false,
      error: 'Twilio env yapılandırılmamış',
    });
    return false;
  }

  const contentVariables = cfg.templateDeliverySid
    ? { '1': params.hotelName, '2': params.waybillNumber, '3': String(params.totalItems), '4': params.date }
    : undefined;
  const result = await twilioSend(cfg, to, fallbackBody, cfg.templateDeliverySid, contentVariables);
  await logNotification(params.tenantId, 'delivery_delivered', to, fallbackBody, result);
  if (result.success) {
    console.log(`Twilio WhatsApp (temiz teslim) gönderildi -> ${to} (sid: ${result.externalId})`);
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
    console.warn(`WhatsApp: gecersiz telefon "${params.toPhone}" - mesaj gönderilmedi`);
    await logNotification(params.tenantId, 'pickup_received', params.toPhone || '', fallbackBody, {
      success: false,
      error: 'Geçersiz telefon numarası',
    });
    return false;
  }
  const cfg = getConfig();
  if (!cfg) {
    console.warn('Twilio yapilandirilmamis - mesaj gönderilmedi');
    await logNotification(params.tenantId, 'pickup_received', to, fallbackBody, {
      success: false,
      error: 'Twilio env yapılandırılmamış',
    });
    return false;
  }

  const contentVariables = cfg.templatePickupSid
    ? { '1': params.hotelName, '2': params.bagCode, '3': String(params.totalItems), '4': params.date }
    : undefined;
  const result = await twilioSend(cfg, to, fallbackBody, cfg.templatePickupSid, contentVariables);
  await logNotification(params.tenantId, 'pickup_received', to, fallbackBody, result);
  if (result.success) {
    console.log(`Twilio WhatsApp (kirli teslim alma) gönderildi -> ${to} (sid: ${result.externalId})`);
  }
  return result.success;
}
