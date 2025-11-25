import { Router } from 'express';
import { db } from '../db';
import { tenants, itemTypes, users } from '../db/schema';
import { requireAuth, AuthRequest, requireRole } from '../middleware/auth';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

// Get all tenants (admin only)
settingsRouter.get('/tenants', requireRole('system_admin'), async (req: AuthRequest, res) => {
  try {
    const allTenants = await db.query.tenants.findMany();
    res.json(allTenants);
  } catch (error) {
    console.error('Get tenants error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create tenant (admin only)
settingsRouter.post('/tenants', requireRole('system_admin'), async (req: AuthRequest, res) => {
  try {
    const { name, email, phone, address } = req.body;

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

// Get item types
settingsRouter.get('/item-types', async (req: AuthRequest, res) => {
  try {
    const allItemTypes = await db.query.itemTypes.findMany();
    res.json(allItemTypes);
  } catch (error) {
    console.error('Get item types error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create item type
settingsRouter.post('/item-types', async (req: AuthRequest, res) => {
  try {
    const { name, description, tenantId } = req.body;

    const [newItemType] = await db.insert(itemTypes).values({
      name,
      description,
      tenantId: tenantId || null,
    }).returning();

    res.status(201).json(newItemType);
  } catch (error) {
    console.error('Create item type error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

