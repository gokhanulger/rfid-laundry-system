import { Router } from 'express';
import { db } from '../db';
import { alerts, items, tenants } from '../db/schema';
import { eq, and, or, isNull, desc } from 'drizzle-orm';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

export const alertsRouter = Router();
alertsRouter.use(requireAuth);

// Validation schemas
const createAlertSchema = z.object({
  tenantId: z.string().uuid().optional(),
  type: z.enum(['missing_item', 'dwell_time', 'damaged_item', 'stained_item', 'high_wash_count', 'system']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  title: z.string().min(1, 'Title is required'),
  message: z.string().min(1, 'Message is required'),
  itemId: z.string().uuid().optional(),
});

// Get all alerts with proper tenant filtering and pagination
alertsRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const { unreadOnly, severity, type } = req.query;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;

    // Build where conditions
    const conditions = [];

    // Tenant isolation: non-admin users can only see their tenant's alerts or system-wide alerts
    if (user.role !== 'system_admin' && user.tenantId) {
      conditions.push(
        or(
          eq(alerts.tenantId, user.tenantId),
          isNull(alerts.tenantId) // System-wide alerts
        )
      );
    }

    // Filter by unread
    if (unreadOnly === 'true') {
      conditions.push(eq(alerts.isRead, false));
    }

    // Filter by severity
    if (severity && typeof severity === 'string') {
      conditions.push(eq(alerts.severity, severity));
    }

    // Filter by type
    if (type && typeof type === 'string') {
      conditions.push(eq(alerts.type, type));
    }

    const allAlerts = await db.query.alerts.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      limit,
      offset,
      orderBy: [desc(alerts.createdAt)],
      with: {
        item: {
          with: {
            itemType: true,
          },
        },
      },
    });

    // Get total count for pagination
    const totalCount = await db.query.alerts.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
    });

    res.json({
      data: allAlerts,
      pagination: {
        page,
        limit,
        total: totalCount.length,
        totalPages: Math.ceil(totalCount.length / limit),
      }
    });
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get unread alert count
alertsRouter.get('/count', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;

    const conditions = [eq(alerts.isRead, false)];

    if (user.role !== 'system_admin' && user.tenantId) {
      conditions.push(
        or(
          eq(alerts.tenantId, user.tenantId),
          isNull(alerts.tenantId)
        ) as any
      );
    }

    const unreadAlerts = await db.query.alerts.findMany({
      where: and(...conditions),
    });

    res.json({ count: unreadAlerts.length });
  } catch (error) {
    console.error('Get alert count error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create alert
alertsRouter.post('/', async (req: AuthRequest, res) => {
  try {
    const validation = createAlertSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors
      });
    }

    const { tenantId, type, severity, title, message, itemId } = validation.data;

    const [newAlert] = await db.insert(alerts).values({
      tenantId: tenantId || null,
      type,
      severity,
      title,
      message,
      itemId: itemId || null,
    }).returning();

    res.status(201).json(newAlert);
  } catch (error) {
    console.error('Create alert error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark alert as read
alertsRouter.patch('/:id/read', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    // Verify alert exists and user has access
    const existingAlert = await db.query.alerts.findFirst({
      where: eq(alerts.id, id),
    });

    if (!existingAlert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    // Check tenant access
    if (user.role !== 'system_admin' && user.tenantId &&
        existingAlert.tenantId && existingAlert.tenantId !== user.tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const [updatedAlert] = await db.update(alerts)
      .set({ isRead: true })
      .where(eq(alerts.id, id))
      .returning();

    res.json(updatedAlert);
  } catch (error) {
    console.error('Mark alert read error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark all alerts as read
alertsRouter.patch('/read-all', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;

    const conditions = [eq(alerts.isRead, false)];

    if (user.role !== 'system_admin' && user.tenantId) {
      conditions.push(eq(alerts.tenantId, user.tenantId));
    }

    await db.update(alerts)
      .set({ isRead: true })
      .where(and(...conditions));

    res.json({ message: 'All alerts marked as read' });
  } catch (error) {
    console.error('Mark all alerts read error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete alert
alertsRouter.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    // Verify alert exists and user has access
    const existingAlert = await db.query.alerts.findFirst({
      where: eq(alerts.id, id),
    });

    if (!existingAlert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    // Only system admin or tenant owner can delete
    if (user.role !== 'system_admin' && user.tenantId &&
        existingAlert.tenantId && existingAlert.tenantId !== user.tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await db.delete(alerts).where(eq(alerts.id, id));

    res.json({ message: 'Alert deleted' });
  } catch (error) {
    console.error('Delete alert error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
