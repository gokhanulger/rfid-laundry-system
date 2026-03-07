import nodemailer from 'nodemailer';

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
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments: options.attachments?.map(a => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
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
  const subject = `Laundry Delivery Completed - ${barcode}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2563eb; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
        .info-box { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #2563eb; }
        .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Laundry Delivery Complete</h1>
        </div>
        <div class="content">
          <p>Dear ${hotelName},</p>
          <p>Your laundry delivery has been completed successfully.</p>

          <div class="info-box">
            <p><strong>Delivery Reference:</strong> ${barcode}</p>
            <p><strong>Items Delivered:</strong> ${itemCount} item${itemCount !== 1 ? 's' : ''}</p>
            <p><strong>Delivery Date:</strong> ${new Date().toLocaleDateString()}</p>
          </div>

          <p>All items have been returned to your location. Please verify the delivery and contact us if you have any questions.</p>

          <p>Thank you for choosing our laundry service!</p>
        </div>
        <div class="footer">
          <p>This is an automated notification from the RFID Laundry Tracking System</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
    Laundry Delivery Complete

    Dear ${hotelName},

    Your laundry delivery has been completed successfully.

    Delivery Reference: ${barcode}
    Items Delivered: ${itemCount} item${itemCount !== 1 ? 's' : ''}
    Delivery Date: ${new Date().toLocaleDateString()}

    All items have been returned to your location. Please verify the delivery and contact us if you have any questions.

    Thank you for choosing our laundry service!
  `;

  return sendEmail({ to, subject, html, text });
}

export async function sendPickupConfirmation(
  to: string,
  hotelName: string,
  bagCode: string,
  itemCount: number
): Promise<boolean> {
  const subject = `Laundry Pickup Confirmed - ${bagCode}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #059669; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
        .info-box { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #059669; }
        .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Laundry Pickup Confirmed</h1>
        </div>
        <div class="content">
          <p>Dear ${hotelName},</p>
          <p>Your laundry has been picked up and is on its way to our facility.</p>

          <div class="info-box">
            <p><strong>Bag Code:</strong> ${bagCode}</p>
            <p><strong>Items Collected:</strong> ${itemCount} item${itemCount !== 1 ? 's' : ''}</p>
            <p><strong>Pickup Date:</strong> ${new Date().toLocaleDateString()}</p>
          </div>

          <p>We will notify you when your items are ready for delivery.</p>

          <p>Thank you for choosing our laundry service!</p>
        </div>
        <div class="footer">
          <p>This is an automated notification from the RFID Laundry Tracking System</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({ to, subject, html, text: `Pickup confirmed. Bag Code: ${bagCode}` });
}

export async function sendAlertNotification(
  to: string,
  alertTitle: string,
  alertMessage: string,
  severity: string
): Promise<boolean> {
  const severityColors: Record<string, string> = {
    low: '#3b82f6',
    medium: '#f59e0b',
    high: '#ef4444',
    critical: '#dc2626',
  };

  const color = severityColors[severity] || '#6b7280';
  const subject = `[${severity.toUpperCase()}] Alert: ${alertTitle}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: ${color}; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
        .severity { display: inline-block; padding: 5px 15px; border-radius: 20px; background: ${color}; color: white; font-weight: bold; }
        .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>System Alert</h1>
        </div>
        <div class="content">
          <p><span class="severity">${severity.toUpperCase()}</span></p>
          <h2>${alertTitle}</h2>
          <p>${alertMessage}</p>
          <p><small>Generated at: ${new Date().toLocaleString()}</small></p>
        </div>
        <div class="footer">
          <p>This is an automated alert from the RFID Laundry Tracking System</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({ to, subject, html });
}

export async function sendWaybillDeliveryEmail(
  to: string,
  hotelName: string,
  waybillNumber: string,
  totalItems: number,
  pdfBuffer: Buffer
): Promise<boolean> {
  const subject = `Teslimat İrsaliyesi - ${waybillNumber}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #0d9488; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
        .info-box { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #0d9488; }
        .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Teslimat Tamamland&#305;</h1>
        </div>
        <div class="content">
          <p>Say&#305;n ${hotelName},</p>
          <p>&#199;ama&#351;&#305;rhane teslimat&#305;n&#305;z ba&#351;ar&#305;yla tamamlanm&#305;&#351;t&#305;r. &#304;rsaliye detaylar&#305; ekte yer almaktad&#305;r.</p>

          <div class="info-box">
            <p><strong>&#304;rsaliye No:</strong> ${waybillNumber}</p>
            <p><strong>Toplam &#220;r&#252;n:</strong> ${totalItems} adet</p>
            <p><strong>Teslimat Tarihi:</strong> ${new Date().toLocaleDateString('tr-TR')}</p>
          </div>

          <p>L&#252;tfen teslimat&#305; kontrol ediniz. Herhangi bir sorunuz varsa bizimle ileti&#351;ime ge&#231;iniz.</p>

          <p>&#304;yi g&#252;nler dileriz.</p>
        </div>
        <div class="footer">
          <p>Demet Laundry - RFID &#199;ama&#351;&#305;rhane Takip Sistemi</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `Sayın ${hotelName},\n\nÇamaşırhane teslimatınız tamamlanmıştır.\nİrsaliye No: ${waybillNumber}\nToplam Ürün: ${totalItems} adet\nTeslimat Tarihi: ${new Date().toLocaleDateString('tr-TR')}\n\nİrsaliye PDF ekte yer almaktadır.`;

  return sendEmail({
    to,
    subject,
    html,
    text,
    attachments: [
      {
        filename: `irsaliye-${waybillNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}
