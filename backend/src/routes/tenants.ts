import { Router } from 'express';
import { db } from '../db';
import { tenants } from '../db/schema';
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

// Delete tenant
tenantsRouter.delete('/:id', requireRole('system_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const existingTenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, id),
    });

    if (!existingTenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    await db.delete(tenants).where(eq(tenants.id, id));

    res.json({ message: 'Tenant deleted' });
  } catch (error) {
    console.error('Delete tenant error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
