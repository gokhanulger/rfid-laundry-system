import { Router } from 'express';
import { db } from '../db';
import {
  tenants,
  deliveries,
  deliveryItems,
  deliveryPackages,
  items,
  users,
  scanSessions,
  alerts,
  auditLogs,
  pickups,
} from '../db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, AuthRequest, requireRole } from '../middleware/auth';
import { z } from 'zod';

export const tenantsRouter = Router();
tenantsRouter.use(requireAuth);

const createTenantSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
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

    const [newTenant] = await db.insert(tenants).values({
      name,
      email,
      phone,
      address,
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

    // Delete related records first (cascade)
    // Import all necessary tables at the top if not already imported

    // Get all delivery IDs for this tenant
    const tenantDeliveries = await db.query.deliveries.findMany({
      where: eq(deliveries.tenantId, id),
      columns: { id: true },
    });
    const deliveryIds = tenantDeliveries.map(d => d.id);

    // Delete delivery-related records
    if (deliveryIds.length > 0) {
      for (const deliveryId of deliveryIds) {
        await db.delete(deliveryItems).where(eq(deliveryItems.deliveryId, deliveryId));
        await db.delete(deliveryPackages).where(eq(deliveryPackages.deliveryId, deliveryId));
      }
      await db.delete(deliveries).where(eq(deliveries.tenantId, id));
    }

    // Delete items for this tenant
    await db.delete(items).where(eq(items.tenantId, id));

    // Delete users associated with this tenant
    await db.delete(users).where(eq(users.tenantId, id));

    // Delete scan sessions
    await db.delete(scanSessions).where(eq(scanSessions.tenantId, id));

    // Delete alerts
    await db.delete(alerts).where(eq(alerts.tenantId, id));

    // Delete audit logs
    await db.delete(auditLogs).where(eq(auditLogs.tenantId, id));

    // Delete pickups
    await db.delete(pickups).where(eq(pickups.tenantId, id));

    // Finally delete the tenant
    await db.delete(tenants).where(eq(tenants.id, id));

    res.json({ message: 'Tenant and all related data deleted' });
  } catch (error) {
    console.error('Delete tenant error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
