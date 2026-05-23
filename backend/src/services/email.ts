import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs';

// ---- Brand (Demet Laundry logosu ile uyumlu) ----
const BRAND_NAVY = '#1b2a66'; // koyu lacivert (logodaki "Demet" / "D")
const BRAND_BLUE = '#1e5fd8'; // kraliyet mavisi (logodaki "Laundry" / dalga)
const BRAND_BG = '#eef1f6';
const LOGO_CID = 'demetlogo';

// Logoyu birden cok olasi konumda arar (dist/assets yoksa src/assets bulunur — fontlarla ayni mantik)
function resolveAssetPath(filename: string): string | null {
  const dirs = [
    path.join(__dirname, '..', 'assets'),
    path.join(process.cwd(), 'dist', 'assets'),
    path.join(process.cwd(), 'src', 'assets'),
    path.join(process.cwd(), 'backend', 'dist', 'assets'),
    path.join(process.cwd(), 'backend', 'src', 'assets'),
  ];
  for (const d of dirs) {
    const p = path.join(d, filename);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const LOGO_PATH = resolveAssetPath('demet-laundry-logo.jpeg');
const LOGO_BUFFER = LOGO_PATH ? fs.readFileSync(LOGO_PATH) : null;

function logoBlock(): string {
  if (!LOGO_BUFFER) {
    return `<div style="font-size:24px;font-weight:bold;color:${BRAND_NAVY};">Demet <span style="color:${BRAND_BLUE}">Laundry</span></div>`;
  }
  return `<img src="cid:${LOGO_CID}" alt="Demet Laundry" width="210" style="display:block;margin:0 auto;width:210px;max-width:78%;height:auto;" />`;
}

// Tum e-postalar icin ortak markali sablon
function brandEmail(opts: { title: string; accent?: string; bodyHtml: string }): string {
  const accent = opts.accent || BRAND_BLUE;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:24px 0;background:${BRAND_BG};font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="padding:26px 20px 14px;text-align:center;background:#ffffff;">
      ${logoBlock()}
    </div>
    <div style="background:${BRAND_NAVY};padding:16px 24px;text-align:center;">
      <h1 style="margin:0;color:#ffffff;font-size:18px;letter-spacing:.3px;">${opts.title}</h1>
    </div>
    <div style="padding:24px 28px;line-height:1.6;font-size:14px;color:#374151;">
      ${opts.bodyHtml}
    </div>
    <div style="border-top:3px solid ${accent};padding:16px 24px;text-align:center;color:#6b7280;font-size:12px;">
      <strong style="color:${BRAND_NAVY};">Demet Laundry</strong> &middot; Otel Tekstil RFID Sistemi
    </div>
  </div>
</body>
</html>`;
}

// Bilgi kutusu (anahtar/deger satirlari)
function infoBox(rows: Array<[string, string]>, accent = BRAND_BLUE): string {
  const trs = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:5px 0;color:#6b7280;">${k}</td><td style="padding:5px 0;text-align:right;font-weight:bold;color:#111827;">${v}</td></tr>`
    )
    .join('');
  return `<div style="background:#f8fafc;border-left:4px solid ${accent};border-radius:8px;padding:14px 16px;margin:16px 0;">
    <table style="width:100%;font-size:14px;border-collapse:collapse;">${trs}</table>
  </div>`;
}

// Create transporter
const createTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn('Email configuration incomplete. Emails will not be sent.');
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  });
};

const transporter = createTransporter();

interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
}

async function sendEmail(options: EmailOptions): Promise<boolean> {
  if (!transporter) {
    console.log('Email not configured. Would have sent:', options.subject, 'to', options.to);
    return false;
  }

  try {
    // Logoyu her e-postaya inline (CID) ekle
    const attachments: any[] = (options.attachments || []).map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    }));
    if (LOGO_BUFFER) {
      attachments.push({
        filename: 'demet-laundry-logo.jpeg',
        content: LOGO_BUFFER,
        cid: LOGO_CID,
        contentType: 'image/jpeg',
      });
    }

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments,
    });
    console.log('Email sent successfully to:', options.to);
    return true;
  } catch (error) {
    console.error('Failed to send email:', error);
    return false;
  }
}

export async function sendDeliveryNotification(
  to: string,
  hotelName: string,
  barcode: string,
  itemCount: number
): Promise<boolean> {
  const subject = `Temiz Teslim İrsaliyesi - ${barcode}`;
  const bodyHtml = `
    <p>Sayın <strong>${hotelName}</strong>,</p>
    <p>Çamaşırhane teslimatınız başarıyla tamamlanmıştır.</p>
    ${infoBox([
      ['İrsaliye No', barcode],
      ['Teslim Edilen', `${itemCount} adet`],
      ['Teslimat Tarihi', new Date().toLocaleDateString('tr-TR')],
    ])}
    <p>Lütfen teslimatı kontrol ediniz. Herhangi bir sorunuz olursa bizimle iletişime geçebilirsiniz.</p>
    <p>İyi günler dileriz.</p>
  `;
  const text = `Sayın ${hotelName},\n\nTemiz teslimatınız tamamlanmıştır.\nİrsaliye No: ${barcode}\nTeslim Edilen: ${itemCount} adet\nTarih: ${new Date().toLocaleDateString('tr-TR')}`;
  return sendEmail({ to, subject, html: brandEmail({ title: 'Temiz Teslim İrsaliyesi', bodyHtml }), text });
}

export async function sendPickupConfirmation(
  to: string,
  hotelName: string,
  bagCode: string,
  itemCount: number
): Promise<boolean> {
  const subject = `Kirli Ürün Teslim Alma İrsaliyesi - ${bagCode}`;
  const bodyHtml = `
    <p>Sayın <strong>${hotelName}</strong>,</p>
    <p>Kirli ürünleriniz teslim alınmış ve çamaşırhanemize ulaşmıştır.</p>
    ${infoBox([
      ['Çuval / Kod', bagCode],
      ['Teslim Alınan', `${itemCount} adet`],
      ['Teslim Alma Tarihi', new Date().toLocaleDateString('tr-TR')],
    ])}
    <p>Ürünleriniz hazır olduğunda sizi ayrıca bilgilendireceğiz.</p>
    <p>İyi günler dileriz.</p>
  `;
  const text = `Sayın ${hotelName},\n\nKirli ürünleriniz teslim alınmıştır.\nÇuval/Kod: ${bagCode}\nTeslim Alınan: ${itemCount} adet\nTarih: ${new Date().toLocaleDateString('tr-TR')}`;
  return sendEmail({ to, subject, html: brandEmail({ title: 'Kirli Ürün Teslim Alma İrsaliyesi', bodyHtml }), text });
}

export async function sendAlertNotification(
  to: string,
  alertTitle: string,
  alertMessage: string,
  severity: string
): Promise<boolean> {
  const severityColors: Record<string, string> = {
    low: BRAND_BLUE,
    medium: '#f59e0b',
    high: '#ef4444',
    critical: '#dc2626',
  };
  const accent = severityColors[severity] || BRAND_BLUE;
  const subject = `[${severity.toUpperCase()}] Uyarı: ${alertTitle}`;
  const bodyHtml = `
    <p><span style="display:inline-block;padding:5px 14px;border-radius:20px;background:${accent};color:#fff;font-weight:bold;font-size:12px;">${severity.toUpperCase()}</span></p>
    <h2 style="color:${BRAND_NAVY};font-size:18px;margin:12px 0 8px;">${alertTitle}</h2>
    <p>${alertMessage}</p>
    <p style="color:#9ca3af;font-size:12px;">Oluşturulma: ${new Date().toLocaleString('tr-TR')}</p>
  `;
  return sendEmail({ to, subject, html: brandEmail({ title: 'Sistem Uyarısı', accent, bodyHtml }) });
}

// Temiz teslim irsaliyesi (PDF ekli)
export async function sendWaybillDeliveryEmail(
  to: string,
  hotelName: string,
  waybillNumber: string,
  totalItems: number,
  pdfBuffer: Buffer
): Promise<boolean> {
  const subject = `Temiz Teslim İrsaliyesi - ${waybillNumber}`;
  const bodyHtml = `
    <p>Sayın <strong>${hotelName}</strong>,</p>
    <p>Çamaşırhane teslimatınız başarıyla tamamlanmıştır. İrsaliye detayları ekteki PDF'te yer almaktadır.</p>
    ${infoBox([
      ['İrsaliye No', waybillNumber],
      ['Toplam Ürün', `${totalItems} adet`],
      ['Teslimat Tarihi', new Date().toLocaleDateString('tr-TR')],
    ])}
    <p>Lütfen teslimatı kontrol ediniz. Herhangi bir sorunuz olursa bizimle iletişime geçebilirsiniz.</p>
    <p>İyi günler dileriz.</p>
  `;
  const text = `Sayın ${hotelName},\n\nTemiz teslimatınız tamamlanmıştır.\nİrsaliye No: ${waybillNumber}\nToplam Ürün: ${totalItems} adet\nTarih: ${new Date().toLocaleDateString('tr-TR')}\n\nİrsaliye PDF ekte yer almaktadır.`;
  return sendEmail({
    to,
    subject,
    html: brandEmail({ title: 'Temiz Teslim İrsaliyesi', bodyHtml }),
    text,
    attachments: [
      { filename: `temiz-teslim-irsaliye-${waybillNumber}.pdf`, content: pdfBuffer, contentType: 'application/pdf' },
    ],
  });
}

// Kirli ürün teslim alma irsaliyesi (PDF ekli)
export async function sendPickupWaybillEmail(
  to: string,
  hotelName: string,
  bagCode: string,
  totalItems: number,
  pdfBuffer: Buffer
): Promise<boolean> {
  const subject = `Kirli Ürün Teslim Alma İrsaliyesi - ${bagCode}`;
  const bodyHtml = `
    <p>Sayın <strong>${hotelName}</strong>,</p>
    <p>Kirli ürünleriniz teslim alınmıştır. İrsaliye detayları ekteki PDF'te yer almaktadır.</p>
    ${infoBox([
      ['İrsaliye / Çuval No', bagCode],
      ['Teslim Alınan', `${totalItems} adet`],
      ['Teslim Alma Tarihi', new Date().toLocaleDateString('tr-TR')],
    ])}
    <p>Ürünleriniz hazır olduğunda sizi ayrıca bilgilendireceğiz.</p>
    <p>İyi günler dileriz.</p>
  `;
  const text = `Sayın ${hotelName},\n\nKirli ürünleriniz teslim alınmıştır.\nİrsaliye/Çuval No: ${bagCode}\nTeslim Alınan: ${totalItems} adet\nTarih: ${new Date().toLocaleDateString('tr-TR')}\n\nİrsaliye PDF ekte yer almaktadır.`;
  return sendEmail({
    to,
    subject,
    html: brandEmail({ title: 'Kirli Ürün Teslim Alma İrsaliyesi', bodyHtml }),
    text,
    attachments: [
      { filename: `kirli-teslim-alma-irsaliye-${bagCode}.pdf`, content: pdfBuffer, contentType: 'application/pdf' },
    ],
  });
}
