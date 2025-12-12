import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db';
import {
  tenants,
  deliveries,
  deliveryItems,
  deliveryPackages,
  items,
  itemTypes,
  users,
  scanSessions,
  scanEvents,
  scanConflicts,
  offlineSyncQueue,
  alerts,
  auditLogs,
  pickups,
  pickupItems,
  devices,
} from '../db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, AuthRequest, requireRole } from '../middleware/auth';
import { z } from 'zod';

export const tenantsRouter = Router();
tenantsRouter.use(requireAuth);

// Generate unique QR code for hotel
function generateQRCode(): string {
  return `HTL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

const createTenantSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
});

const updateTenantSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  isActive: z.boolean().optional(),
});

// Get all tenants
tenantsRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const allTenants = await db.query.tenants.findMany({
      orderBy: (tenants, { asc }) => [asc(tenants.name)],
    });
    res.json(allTenants);
  } catch (error) {
    console.error('Get tenants error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get tenant by ID
tenantsRouter.get('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, id),
    });

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    res.json(tenant);
  } catch (error) {
    console.error('Get tenant error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create tenant
tenantsRouter.post('/', requireRole('system_admin', 'laundry_manager'), async (req: AuthRequest, res) => {
  try {
    const validation = createTenantSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const { name, email, phone, address } = validation.data;

    // Check for duplicate name
    const existing = await db.query.tenants.findFirst({
      where: eq(tenants.name, name.trim()),
    });

    if (existing) {
      return res.status(400).json({ error: 'Bu isimde otel zaten mevcut' });
    }

    // Generate unique QR code
    const qrCode = generateQRCode();

    const [newTenant] = await db.insert(tenants).values({
      name: name.trim(),
      email,
      phone,
      address,
      qrCode,
    }).returning();

    res.status(201).json(newTenant);
  } catch (error) {
    console.error('Create tenant error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update tenant
tenantsRouter.patch('/:id', requireRole('system_admin', 'laundry_manager'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const validation = updateTenantSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const existingTenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, id),
    });

    if (!existingTenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const [updatedTenant] = await db.update(tenants)
      .set({
        ...validation.data,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, id))
      .returning();

    res.json(updatedTenant);
  } catch (error) {
    console.error('Update tenant error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete tenant with cascade
tenantsRouter.delete('/:id', requireRole('system_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const existingTenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, id),
    });

    if (!existingTenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Delete related records first (cascade) - ORDER MATTERS!
    // Must delete in reverse dependency order

    // 1. Get all IDs we need first
    const tenantDeliveries = await db.query.deliveries.findMany({
      where: eq(deliveries.tenantId, id),
      columns: { id: true },
    });
    const deliveryIds = tenantDeliveries.map(d => d.id);

    const tenantPickups = await db.query.pickups.findMany({
      where: eq(pickups.tenantId, id),
      columns: { id: true },
    });

    const tenantSessions = await db.query.scanSessions.findMany({
      where: eq(scanSessions.tenantId, id),
      columns: { id: true },
    });

    const tenantDevices = await db.query.devices.findMany({
      where: eq(devices.tenantId, id),
      columns: { id: true },
    });

    const tenantItems = await db.query.items.findMany({
      where: eq(items.tenantId, id),
      columns: { id: true },
    });
    const itemIds = tenantItems.map(i => i.id);

    // 2. Delete scan conflicts (references sessions and devices)
    for (const session of tenantSessions) {
      await db.delete(scanConflicts).where(eq(scanConflicts.winningSessionId, session.id));
      await db.delete(scanConflicts).where(eq(scanConflicts.conflictingSessionId, session.id));
    }
    for (const device of tenantDevices) {
      await db.delete(scanConflicts).where(eq(scanConflicts.winningDeviceId, device.id));
      await db.delete(scanConflicts).where(eq(scanConflicts.conflictingDeviceId, device.id));
    }

    // 3. Delete scan events (references sessions and items)
    for (const session of tenantSessions) {
      await db.delete(scanEvents).where(eq(scanEvents.sessionId, session.id));
    }

    // 4. Delete scan sessions
    await db.delete(scanSessions).where(eq(scanSessions.tenantId, id));

    // 5. Delete offline sync queue (references devices)
    for (const device of tenantDevices) {
      await db.delete(offlineSyncQueue).where(eq(offlineSyncQueue.deviceId, device.id));
    }

    // 6. Delete devices
    await db.delete(devices).where(eq(devices.tenantId, id));

    // 7. Delete alerts (references tenant and items)
    await db.delete(alerts).where(eq(alerts.tenantId, id));
    for (const itemId of itemIds) {
      await db.delete(alerts).where(eq(alerts.itemId, itemId));
    }

    // 8. Delete audit logs
    await db.delete(auditLogs).where(eq(auditLogs.tenantId, id));

    // 9. Delete delivery packages (references deliveries)
    for (const deliveryId of deliveryIds) {
      await db.delete(deliveryPackages).where(eq(deliveryPackages.deliveryId, deliveryId));
    }

    // 10. Delete delivery items (references deliveries and items)
    for (const deliveryId of deliveryIds) {
      await db.delete(deliveryItems).where(eq(deliveryItems.deliveryId, deliveryId));
    }

    // 11. Delete deliveries
    await db.delete(deliveries).where(eq(deliveries.tenantId, id));

    // 12. Delete pickup items (references pickups and items)
    for (const pickup of tenantPickups) {
      await db.delete(pickupItems).where(eq(pickupItems.pickupId, pickup.id));
    }

    // 13. Delete pickups
    await db.delete(pickups).where(eq(pickups.tenantId, id));

    // 14. Delete items (references itemTypes and tenants)
    await db.delete(items).where(eq(items.tenantId, id));

    // 15. Delete tenant-specific item types
    await db.delete(itemTypes).where(eq(itemTypes.tenantId, id));

    // 16. Delete users
    await db.delete(users).where(eq(users.tenantId, id));

    // 17. Finally delete the tenant
    await db.delete(tenants).where(eq(tenants.id, id));

    res.json({ message: 'Tenant and all related data deleted' });
  } catch (error) {
    console.error('Delete tenant error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
