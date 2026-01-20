import { db } from '../db';
import {
  notificationSettings,
  notificationTemplates,
  notificationLogs,
  tenants
} from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '../utils/logger';

// Types
export type NotificationChannel = 'whatsapp' | 'sms' | 'email' | 'webhook';
export type NotificationEvent =
  | 'delivery_created'
  | 'delivery_packaged'
  | 'delivery_picked_up'
  | 'delivery_delivered'
  | 'pickup_created'
  | 'pickup_received'
  | 'daily_summary'
  | 'alert_new';

export interface NotificationData {
  hotel_name?: string;
  item_count?: number;
  barcode?: string;
  package_count?: number;
  driver_name?: string;
  bag_code?: string;
  at_hotel?: number;
  at_laundry?: number;
  in_transit?: number;
  [key: string]: string | number | undefined;
}

interface SendResult {
  success: boolean;
  externalId?: string;
  error?: string;
}

// Replace template placeholders with actual values
function replaceTemplateVariables(template: string, data: NotificationData): string {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
    }
  }
  return result;
}

// Send WhatsApp message via Meta Business API
async function sendWhatsAppMessage(
  phoneId: string,
  accessToken: string,
  recipient: string,
  message: string
): Promise<SendResult> {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient.replace(/\D/g, ''), // Remove non-digits
          type: 'text',
          text: { body: message }
        }),
      }
    );

    const result = await response.json() as { error?: { message?: string }; messages?: { id: string }[] };

    if (!response.ok) {
      logger.error('WhatsApp API error', { error: result });
      return {
        success: false,
        error: result.error?.message || 'WhatsApp API error'
      };
    }

    return {
      success: true,
      externalId: result.messages?.[0]?.id
    };
  } catch (error) {
    logger.error('WhatsApp send error', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Send webhook notification
async function sendWebhook(
  url: string,
  secret: string | null,
  event: NotificationEvent,
  data: NotificationData,
  message: string
): Promise<SendResult> {
  try {
    const payload = {
      event,
      timestamp: new Date().toISOString(),
      data,
      message
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (secret) {
      // Create HMAC signature for webhook verification
      const crypto = await import('crypto');
      const signature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');
      headers['X-Webhook-Signature'] = signature;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Webhook returned ${response.status}`
      };
    }

    return { success: true };
  } catch (error) {
    logger.error('Webhook send error', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Main notification service
export class NotificationService {
  // Send notification for a specific event
  async sendNotification(
    tenantId: string,
    event: NotificationEvent,
    data: NotificationData
  ): Promise<void> {
    try {
      // Get tenant info
      const [tenant] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);

      if (!tenant) {
        logger.warn('Tenant not found for notification', { tenantId });
        return;
      }

      // Add hotel name to data if not provided
      if (!data.hotel_name) {
        data.hotel_name = tenant.name;
      }

      // Get all enabled notification settings for this tenant
      const settings = await db
        .select()
        .from(notificationSettings)
        .where(
          and(
            eq(notificationSettings.tenantId, tenantId),
            eq(notificationSettings.isEnabled, true)
          )
        );

      for (const setting of settings) {
        // Check if this setting is configured for this event
        const events = setting.events as NotificationEvent[] | null;
        if (!events || !events.includes(event)) {
          continue;
        }

        // Get template for this event and channel
        const [template] = await db
          .select()
          .from(notificationTemplates)
          .where(
            and(
              eq(notificationTemplates.event, event),
              eq(notificationTemplates.channel, setting.channel),
              eq(notificationTemplates.isActive, true)
            )
          )
          .limit(1);

        if (!template) {
          logger.warn('No template found', { event, channel: setting.channel });
          continue;
        }

        // Replace template variables
        const message = replaceTemplateVariables(template.content, data);
        const subject = template.subject
          ? replaceTemplateVariables(template.subject, data)
          : null;

        // Determine recipient
        let recipient = '';

        if (setting.channel === 'whatsapp') {
          recipient = setting.whatsappRecipient || tenant.notificationPhone || '';
        } else if (setting.channel === 'webhook') {
          recipient = setting.webhookUrl || '';
        }

        if (!recipient) {
          logger.warn('No recipient configured', {
            tenantId,
            channel: setting.channel
          });
          continue;
        }

        // Send notification based on channel
        let result: SendResult;

        switch (setting.channel) {
          case 'whatsapp':
            if (!setting.whatsappPhoneId || !setting.whatsappAccessToken) {
              logger.warn('WhatsApp not configured', { tenantId });
              result = { success: false, error: 'WhatsApp not configured' };
            } else {
              result = await sendWhatsAppMessage(
                setting.whatsappPhoneId,
                setting.whatsappAccessToken,
                recipient,
                message
              );
            }
            break;

          case 'webhook':
            result = await sendWebhook(
              recipient,
              setting.webhookSecret,
              event,
              data,
              message
            );
            break;

          case 'sms':
          case 'email':
            // These can be implemented later with other providers
            result = { success: false, error: `${setting.channel} not implemented` };
            break;

          default:
            result = { success: false, error: 'Unknown channel' };
        }

        // Log the notification
        await db.insert(notificationLogs).values({
          tenantId,
          channel: setting.channel,
          event,
          recipient,
          subject,
          content: message,
          status: result.success ? 'sent' : 'failed',
          externalId: result.externalId || null,
          errorMessage: result.error || null,
          sentAt: result.success ? new Date() : null,
        });
      }
    } catch (error) {
      logger.error('Notification service error', { error, tenantId, event });
    }
  }

  // Convenience methods for specific events
  async onDeliveryCreated(tenantId: string, data: NotificationData): Promise<void> {
    await this.sendNotification(tenantId, 'delivery_created', data);
  }

  async onDeliveryPackaged(tenantId: string, data: NotificationData): Promise<void> {
    await this.sendNotification(tenantId, 'delivery_packaged', data);
  }

  async onDeliveryPickedUp(tenantId: string, data: NotificationData): Promise<void> {
    await this.sendNotification(tenantId, 'delivery_picked_up', data);
  }

  async onDeliveryDelivered(tenantId: string, data: NotificationData): Promise<void> {
    await this.sendNotification(tenantId, 'delivery_delivered', data);
  }

  async onPickupCreated(tenantId: string, data: NotificationData): Promise<void> {
    await this.sendNotification(tenantId, 'pickup_created', data);
  }

  async onPickupReceived(tenantId: string, data: NotificationData): Promise<void> {
    await this.sendNotification(tenantId, 'pickup_received', data);
  }

  async onDailySummary(tenantId: string, data: NotificationData): Promise<void> {
    await this.sendNotification(tenantId, 'daily_summary', data);
  }

  async onAlertNew(tenantId: string, data: NotificationData): Promise<void> {
    await this.sendNotification(tenantId, 'alert_new', data);
  }

  // Send test notification
  async sendTestNotification(
    tenantId: string,
    channel: NotificationChannel,
    recipient: string
  ): Promise<{ success: boolean; error?: string }> {
    const testData: NotificationData = {
      hotel_name: 'Test Hotel',
      item_count: 100,
      barcode: 'TEST-123456',
    };

    const message = `Bu bir test bildirimidir. / This is a test notification.\n\nOtel: ${testData.hotel_name}\nAdet: ${testData.item_count}`;

    // Get settings for this channel
    const [setting] = await db
      .select()
      .from(notificationSettings)
      .where(
        and(
          eq(notificationSettings.tenantId, tenantId),
          eq(notificationSettings.channel, channel)
        )
      )
      .limit(1);

    let result: SendResult;

    switch (channel) {
      case 'whatsapp':
        if (!setting?.whatsappPhoneId || !setting?.whatsappAccessToken) {
          return { success: false, error: 'WhatsApp not configured' };
        }
        result = await sendWhatsAppMessage(
          setting.whatsappPhoneId,
          setting.whatsappAccessToken,
          recipient,
          message
        );
        break;

      case 'webhook':
        if (!setting?.webhookUrl) {
          return { success: false, error: 'Webhook URL not configured' };
        }
        result = await sendWebhook(
          setting.webhookUrl,
          setting.webhookSecret,
          'delivery_created',
          testData,
          message
        );
        break;

      default:
        return { success: false, error: `${channel} not implemented` };
    }

    // Log test notification
    await db.insert(notificationLogs).values({
      tenantId,
      channel,
      event: 'delivery_created',
      recipient,
      subject: 'Test Notification',
      content: message,
      status: result.success ? 'sent' : 'failed',
      externalId: result.externalId || null,
      errorMessage: result.error || null,
      sentAt: result.success ? new Date() : null,
    });

    return result;
  }
}

// Singleton instance
export const notificationService = new NotificationService();
