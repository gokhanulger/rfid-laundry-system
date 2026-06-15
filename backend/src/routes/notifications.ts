import express, { Router, Response } from 'express';
import crypto from 'crypto';
import { db } from '../db';
import {
  notificationSettings,
  notificationTemplates,
  notificationLogs,
  tenants
} from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';
import { notificationService, NotificationChannel } from '../services/notifications';
import { logger } from '../utils/logger';

const router = Router();

// ============================================
// PUBLIC TWILIO WEBHOOKS (auth'tan ÖNCE tanımlı olmalı)
// ============================================

// Twilio mesaj durumu callback: queued/sent/delivered/read/failed/undelivered
// Twilio Console -> Messaging -> WhatsApp Sender (veya Programmable Messaging)
// Status callback URL alanına şu URL girilir:
//   https://<backend>/api/notifications/twilio-status
// notification_logs.status güncellenir. X-Twilio-Signature ile doğrulanır.
router.post(
  '/twilio-status',
  express.urlencoded({ extended: false }),
  async (req: any, res: Response) => {
    try {
      // Twilio imza doğrulama (HMAC-SHA1 of URL + sorted params concat) — auth token varsa kontrol
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const signature = req.headers['x-twilio-signature'] as string | undefined;
      if (authToken && signature) {
        const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
        const host = req.headers['host'];
        const fullUrl = `${proto}://${host}${req.originalUrl}`;
        const sortedKeys = Object.keys(req.body || {}).sort();
        const concatenated = sortedKeys.reduce((acc, k) => acc + k + (req.body[k] ?? ''), fullUrl);
        const expected = crypto.createHmac('sha1', authToken).update(concatenated).digest('base64');
        if (expected !== signature) {
          logger.warn('Twilio signature mismatch', { fullUrl });
          return res.status(403).send('Invalid signature');
        }
      }

      const sid = req.body.MessageSid as string | undefined;
      const messageStatus = req.body.MessageStatus as string | undefined;
      const errorCode = req.body.ErrorCode as string | undefined;
      const errorMessage = req.body.ErrorMessage as string | undefined;

      if (!sid || !messageStatus) {
        return res.status(400).send('Missing MessageSid or MessageStatus');
      }

      const updateData: Record<string, any> = {};
      if (messageStatus === 'delivered' || messageStatus === 'read') {
        updateData.status = 'delivered';
        updateData.deliveredAt = new Date();
      } else if (messageStatus === 'failed' || messageStatus === 'undelivered') {
        updateData.status = 'failed';
        if (errorCode || errorMessage) {
          updateData.errorMessage = [errorCode, errorMessage].filter(Boolean).join(' - ');
        }
      } else if (messageStatus === 'sent') {
        updateData.status = 'sent';
      }

      if (Object.keys(updateData).length > 0) {
        await db.update(notificationLogs).set(updateData).where(eq(notificationLogs.externalId, sid));
      }

      logger.info('Twilio status callback', { sid, messageStatus });
      res.status(200).send('OK');
    } catch (err) {
      logger.error('Twilio status callback error', { err });
      res.status(500).send('Error');
    }
  }
);

// Twilio gelen mesaj (müşteri cevap atarsa) — şimdilik sadece log
router.post('/twilio-inbound', express.urlencoded({ extended: false }), async (req: any, res: Response) => {
  try {
    logger.info('Twilio inbound message', {
      from: req.body.From,
      to: req.body.To,
      body: req.body.Body,
    });
    res.status(200).send('OK');
  } catch (err) {
    res.status(500).send('Error');
  }
});

// All routes require authentication
router.use(requireAuth);

// ============================================
// NOTIFICATION SETTINGS
// ============================================

// Get notification settings for a tenant
router.get('/settings/:tenantId', requireRole('system_admin', 'hotel_owner'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId } = req.params;

    // Hotel owners can only see their own tenant
    if (req.user!.role === 'hotel_owner' && req.user!.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Bu otel ayarlarını görüntüleme yetkiniz yok' });
    }

    const settings = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.tenantId, tenantId));

    // Get tenant info
    const [tenant] = await db
      .select({
        notificationEnabled: tenants.notificationEnabled,
        notificationPhone: tenants.notificationPhone
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    res.json({
      tenant,
      settings
    });
  } catch (error) {
    logger.error('Get notification settings error', { error });
    res.status(500).json({ error: 'Ayarlar alınamadı' });
  }
});

// Create or update notification setting
router.post('/settings/:tenantId', requireRole('system_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId } = req.params;
    const {
      channel,
      isEnabled,
      events,
      whatsappPhoneId,
      whatsappAccessToken,
      whatsappRecipient,
      webhookUrl,
      webhookSecret
    } = req.body;

    if (!channel) {
      return res.status(400).json({ error: 'Kanal belirtilmeli' });
    }

    // Check if setting exists
    const [existing] = await db
      .select()
      .from(notificationSettings)
      .where(
        and(
          eq(notificationSettings.tenantId, tenantId),
          eq(notificationSettings.channel, channel)
        )
      )
      .limit(1);

    if (existing) {
      // Update existing
      const [updated] = await db
        .update(notificationSettings)
        .set({
          isEnabled: isEnabled ?? existing.isEnabled,
          events: events ? JSON.stringify(events) : existing.events,
          whatsappPhoneId: whatsappPhoneId ?? existing.whatsappPhoneId,
          whatsappAccessToken: whatsappAccessToken ?? existing.whatsappAccessToken,
          whatsappRecipient: whatsappRecipient ?? existing.whatsappRecipient,
          webhookUrl: webhookUrl ?? existing.webhookUrl,
          webhookSecret: webhookSecret ?? existing.webhookSecret,
          updatedAt: new Date()
        })
        .where(eq(notificationSettings.id, existing.id))
        .returning();

      res.json(updated);
    } else {
      // Create new
      const [created] = await db
        .insert(notificationSettings)
        .values({
          tenantId,
          channel,
          isEnabled: isEnabled ?? true,
          events: events ? JSON.stringify(events) : '[]',
          whatsappPhoneId,
          whatsappAccessToken,
          whatsappRecipient,
          webhookUrl,
          webhookSecret
        })
        .returning();

      res.status(201).json(created);
    }
  } catch (error) {
    logger.error('Save notification setting error', { error });
    res.status(500).json({ error: 'Ayar kaydedilemedi' });
  }
});

// Delete notification setting
router.delete('/settings/:tenantId/:channel', requireRole('system_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId, channel } = req.params;

    await db
      .delete(notificationSettings)
      .where(
        and(
          eq(notificationSettings.tenantId, tenantId),
          eq(notificationSettings.channel, channel as NotificationChannel)
        )
      );

    res.json({ success: true });
  } catch (error) {
    logger.error('Delete notification setting error', { error });
    res.status(500).json({ error: 'Ayar silinemedi' });
  }
});

// Update tenant notification settings
router.patch('/tenant/:tenantId', requireRole('system_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId } = req.params;
    const { notificationEnabled, notificationPhone } = req.body;

    const [updated] = await db
      .update(tenants)
      .set({
        notificationEnabled: notificationEnabled,
        notificationPhone: notificationPhone,
        updatedAt: new Date()
      })
      .where(eq(tenants.id, tenantId))
      .returning();

    res.json(updated);
  } catch (error) {
    logger.error('Update tenant notification error', { error });
    res.status(500).json({ error: 'Otel ayarları güncellenemedi' });
  }
});

// ============================================
// NOTIFICATION TEMPLATES
// ============================================

// Get all templates
router.get('/templates', requireRole('system_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const templates = await db
      .select()
      .from(notificationTemplates)
      .orderBy(notificationTemplates.event, notificationTemplates.channel);

    res.json(templates);
  } catch (error) {
    logger.error('Get templates error', { error });
    res.status(500).json({ error: 'Şablonlar alınamadı' });
  }
});

// Create template
router.post('/templates', requireRole('system_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, event, channel, subject, content, isActive } = req.body;

    if (!name || !event || !channel || !content) {
      return res.status(400).json({ error: 'Ad, olay, kanal ve içerik zorunludur' });
    }

    const [created] = await db
      .insert(notificationTemplates)
      .values({
        name,
        event,
        channel,
        subject,
        content,
        isActive: isActive ?? true
      })
      .returning();

    res.status(201).json(created);
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Bu olay ve kanal için şablon zaten mevcut' });
    }
    logger.error('Create template error', { error });
    res.status(500).json({ error: 'Şablon oluşturulamadı' });
  }
});

// Update template
router.patch('/templates/:id', requireRole('system_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, subject, content, isActive } = req.body;

    const [updated] = await db
      .update(notificationTemplates)
      .set({
        name: name,
        subject: subject,
        content: content,
        isActive: isActive,
        updatedAt: new Date()
      })
      .where(eq(notificationTemplates.id, id))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: 'Şablon bulunamadı' });
    }

    res.json(updated);
  } catch (error) {
    logger.error('Update template error', { error });
    res.status(500).json({ error: 'Şablon güncellenemedi' });
  }
});

// Delete template
router.delete('/templates/:id', requireRole('system_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    await db
      .delete(notificationTemplates)
      .where(eq(notificationTemplates.id, id));

    res.json({ success: true });
  } catch (error) {
    logger.error('Delete template error', { error });
    res.status(500).json({ error: 'Şablon silinemedi' });
  }
});

// ============================================
// NOTIFICATION LOGS
// ============================================

// Get notification logs
router.get('/logs', requireRole('system_admin', 'laundry_manager', 'hotel_owner'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId, channel, status, limit = '50', offset = '0' } = req.query;
    const conditions: any[] = [];

    // Hotel owners can only see their own logs
    if (req.user!.role === 'hotel_owner') {
      conditions.push(eq(notificationLogs.tenantId, req.user!.tenantId!));
    } else if (tenantId) {
      conditions.push(eq(notificationLogs.tenantId, tenantId as string));
    }
    if (channel) conditions.push(eq(notificationLogs.channel, channel as NotificationChannel));
    if (status) conditions.push(eq(notificationLogs.status, status as any));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Tenant adini leftJoin ile cekiyoruz (relational query'den daha guvenilir)
    const rows = await db
      .select({
        id: notificationLogs.id,
        tenantId: notificationLogs.tenantId,
        channel: notificationLogs.channel,
        event: notificationLogs.event,
        recipient: notificationLogs.recipient,
        subject: notificationLogs.subject,
        content: notificationLogs.content,
        status: notificationLogs.status,
        externalId: notificationLogs.externalId,
        errorMessage: notificationLogs.errorMessage,
        sentAt: notificationLogs.sentAt,
        deliveredAt: notificationLogs.deliveredAt,
        createdAt: notificationLogs.createdAt,
        tenantName: tenants.name,
      })
      .from(notificationLogs)
      .leftJoin(tenants, eq(notificationLogs.tenantId, tenants.id))
      .where(where)
      .orderBy(desc(notificationLogs.createdAt))
      .limit(parseInt(limit as string))
      .offset(parseInt(offset as string));

    // Frontend'de `log.tenant.name` bekliyor; mapleyelim
    const logs = rows.map((r: any) => ({
      id: r.id,
      tenantId: r.tenantId,
      channel: r.channel,
      event: r.event,
      recipient: r.recipient,
      subject: r.subject,
      content: r.content,
      status: r.status,
      externalId: r.externalId,
      errorMessage: r.errorMessage,
      sentAt: r.sentAt,
      deliveredAt: r.deliveredAt,
      createdAt: r.createdAt,
      tenant: r.tenantName ? { id: r.tenantId, name: r.tenantName } : null,
    }));

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(notificationLogs)
      .where(where);

    res.json({
      logs,
      total: Number(count),
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
  } catch (error) {
    logger.error('Get logs error', { error });
    res.status(500).json({ error: 'Loglar alınamadı' });
  }
});

// Get notification stats
router.get('/stats', requireRole('system_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId } = req.query;

    const conditions = tenantId
      ? [eq(notificationLogs.tenantId, tenantId as string)]
      : [];

    // Get counts by status
    const statusStats = await db
      .select({
        status: notificationLogs.status,
        count: sql<number>`count(*)`
      })
      .from(notificationLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(notificationLogs.status);

    // Get counts by channel
    const channelStats = await db
      .select({
        channel: notificationLogs.channel,
        count: sql<number>`count(*)`
      })
      .from(notificationLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(notificationLogs.channel);

    // Get recent failures
    const recentFailures = await db
      .select()
      .from(notificationLogs)
      .where(
        conditions.length > 0
          ? and(...conditions, eq(notificationLogs.status, 'failed'))
          : eq(notificationLogs.status, 'failed')
      )
      .orderBy(desc(notificationLogs.createdAt))
      .limit(10);

    res.json({
      byStatus: statusStats,
      byChannel: channelStats,
      recentFailures
    });
  } catch (error) {
    logger.error('Get notification stats error', { error });
    res.status(500).json({ error: 'İstatistikler alınamadı' });
  }
});

// ============================================
// TEST NOTIFICATION
// ============================================

// Send test notification
router.post('/test', requireRole('system_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId, channel, recipient } = req.body;

    if (!tenantId || !channel || !recipient) {
      return res.status(400).json({ error: 'Otel, kanal ve alıcı zorunludur' });
    }

    const result = await notificationService.sendTestNotification(
      tenantId,
      channel,
      recipient
    );

    if (result.success) {
      res.json({ success: true, message: 'Test bildirimi gönderildi' });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    logger.error('Send test notification error', { error });
    res.status(500).json({ error: 'Test bildirimi gönderilemedi' });
  }
});

// ============================================
// WEBHOOK CALLBACK (for delivery status updates)
// ============================================

// WhatsApp webhook verification (Meta requires this)
router.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Check if mode and token are in the query string
  if (mode && token) {
    // Verify token - should match env variable
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'rfid_laundry_webhook';

    if (mode === 'subscribe' && token === verifyToken) {
      logger.info('WhatsApp webhook verified');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// WhatsApp webhook for status updates
router.post('/webhook/whatsapp', async (req, res) => {
  try {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
      body.entry?.forEach((entry: any) => {
        entry.changes?.forEach((change: any) => {
          const statuses = change.value?.statuses;

          if (statuses) {
            statuses.forEach(async (status: any) => {
              const messageId = status.id;
              const statusValue = status.status; // sent, delivered, read, failed

              // Update notification log
              if (statusValue === 'delivered' || statusValue === 'read') {
                await db
                  .update(notificationLogs)
                  .set({
                    status: 'delivered',
                    deliveredAt: new Date()
                  })
                  .where(eq(notificationLogs.externalId, messageId));
              } else if (statusValue === 'failed') {
                await db
                  .update(notificationLogs)
                  .set({
                    status: 'failed',
                    errorMessage: status.errors?.[0]?.message || 'Delivery failed'
                  })
                  .where(eq(notificationLogs.externalId, messageId));
              }
            });
          }
        });
      });
    }

    res.sendStatus(200);
  } catch (error) {
    logger.error('WhatsApp webhook error', { error });
    res.sendStatus(500);
  }
});

export const notificationsRouter = router;
