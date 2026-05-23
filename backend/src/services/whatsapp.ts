/**
 * WhatsApp Cloud API (Meta / Facebook) — teslimat bildirimi gonderici.
 *
 * Camasirhane TEK gonderici hesaptir; alici her otelin kendi telefonudur.
 * Bu yuzden kimlik bilgileri tenant bazli DEGIL, env uzerinden global gelir:
 *
 *   WHATSAPP_PHONE_ID        Meta WhatsApp telefon numarasi ID'si (zorunlu)
 *   WHATSAPP_ACCESS_TOKEN    Kalici (system user) access token (zorunlu)
 *   WHATSAPP_API_VERSION     Graph API surumu (varsayilan: v18.0)
 *   WHATSAPP_TEMPLATE_NAME   Meta'da onaylanan sablon adi (varsayilan: teslimat_bildirimi)
 *   WHATSAPP_TEMPLATE_LANG   Sablon dil kodu (varsayilan: tr)
 *   WHATSAPP_USE_TEMPLATE    'false' ise serbest metin gonderir (sadece 24sa penceresi/test)
 *
 * ONEMLI: Isletmenin baslattigi (kullanici son 24 saatte yazmadiysa) mesajlar icin
 * Meta yalnizca ONAYLI SABLON mesajlarina izin verir; serbest metin reddedilir.
 * Bu yuzden varsayilan olarak sablon modu kullanilir.
 *
 * Onerilen sablon govdesi (4 parametre), Meta Business Manager'da olusturulup
 * onaylatilmalidir (kategori: UTILITY, dil: Turkish):
 *
 *   Sayin {{1}}, camasir teslimatiniz tamamlanmistir.
 *   Irsaliye No: {{2}} - Toplam: {{3}} adet - Tarih: {{4}}.
 *   Irsaliye PDF'i e-posta adresinize gonderilmistir.
 */

export interface DeliveryWhatsAppParams {
  toPhone: string;
  hotelName: string;
  waybillNumber: string;
  totalItems: number;
  date: string; // tr-TR formatli tarih
}

/**
 * Turkiye telefon numarasini Meta'nin bekledigi formata cevirir (basinda + olmadan, E.164 rakamlar).
 * Ornekler: "0532 123 45 67" -> "905321234567", "+90 532..." -> "905321234567", "532..." -> "905321234567"
 * Cevrilemiyorsa null doner.
 */
export function normalizeTurkishPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  // Uluslararasi cikis kodu 00 -> kaldir
  if (digits.startsWith('00')) digits = digits.slice(2);

  // 0XXXXXXXXXX (11 hane, basinda 0) -> 90 + 10 hane
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = '90' + digits.slice(1);
  }
  // 5XXXXXXXXX (10 hane, ulke kodsuz) -> 90 ekle
  else if (digits.length === 10) {
    digits = '90' + digits;
  }
  // Zaten 90 ile baslayan 12 hane -> oldugu gibi birak

  // Gecerli bir TR cep/sabit numarasi en az 12 hane (90 + 10) olmali
  if (digits.length < 11) return null;
  return digits;
}

interface WhatsAppConfig {
  phoneId: string;
  accessToken: string;
  apiVersion: string;
  templateName: string;
  templateLang: string;
  useTemplate: boolean;
}

function getConfig(): WhatsAppConfig | null {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !accessToken) {
    return null;
  }
  return {
    phoneId,
    accessToken,
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v18.0',
    templateName: process.env.WHATSAPP_TEMPLATE_NAME || 'teslimat_bildirimi',
    templateLang: process.env.WHATSAPP_TEMPLATE_LANG || 'tr',
    useTemplate: (process.env.WHATSAPP_USE_TEMPLATE || 'true').toLowerCase() !== 'false',
  };
}

/**
 * Teslimat tamamlandiginda otelin telefonuna WhatsApp bildirimi gonderir.
 * Hata firlatmaz; basarisizlikta false doner ki teslimat akisi bozulmasin.
 */
export async function sendDeliveryWhatsApp(params: DeliveryWhatsAppParams): Promise<boolean> {
  const config = getConfig();
  if (!config) {
    console.warn('WhatsApp yapilandirilmamis (WHATSAPP_PHONE_ID / WHATSAPP_ACCESS_TOKEN yok). Mesaj gonderilmedi.');
    return false;
  }

  const to = normalizeTurkishPhone(params.toPhone);
  if (!to) {
    console.warn(`WhatsApp: gecersiz telefon numarasi "${params.toPhone}", mesaj gonderilmedi.`);
    return false;
  }

  const { phoneId, accessToken, apiVersion, templateName, templateLang, useTemplate } = config;
  const url = `https://graph.facebook.com/${apiVersion}/${phoneId}/messages`;

  let body: Record<string, unknown>;
  if (useTemplate) {
    body = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: templateLang },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: params.hotelName },
              { type: 'text', text: params.waybillNumber },
              { type: 'text', text: String(params.totalItems) },
              { type: 'text', text: params.date },
            ],
          },
        ],
      },
    };
  } else {
    // Serbest metin — sadece 24 saatlik musteri penceresi / test icin
    const message =
      `Sayin ${params.hotelName}, camasir teslimatiniz tamamlanmistir.\n` +
      `Irsaliye No: ${params.waybillNumber}\n` +
      `Toplam: ${params.totalItems} adet\n` +
      `Tarih: ${params.date}\n` +
      `Irsaliye PDF'i e-posta adresinize gonderilmistir.`;
    body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: message },
    };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const result = (await response.json()) as {
      error?: { message?: string };
      messages?: { id: string }[];
    };

    if (!response.ok) {
      console.error('WhatsApp gonderim hatasi:', result.error?.message || JSON.stringify(result));
      return false;
    }

    console.log(`WhatsApp teslimat bildirimi gonderildi -> ${to} (msg id: ${result.messages?.[0]?.id || 'n/a'})`);
    return true;
  } catch (error) {
    console.error('WhatsApp gonderim istisnasi:', error);
    return false;
  }
}
