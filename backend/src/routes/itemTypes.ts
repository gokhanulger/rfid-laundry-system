import { Router } from 'express';
import { db } from '../db';
import { itemTypes } from '../db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, AuthRequest, requireRole } from '../middleware/auth';
import { z } from 'zod';

export const itemTypesRouter = Router();
itemTypesRouter.use(requireAuth);

const createItemTypeSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  tenantId: z.string().uuid().optional(),
});

const updateItemTypeSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});

// Get all item types
itemTypesRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const allItemTypes = await db.query.itemTypes.findMany({
      orderBy: (itemTypes, { asc }) => [asc(itemTypes.name)],
    });
    res.json(allItemTypes);
  } catch (error) {
    console.error('Get item types error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get item type by ID
itemTypesRouter.get('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const itemType = await db.query.itemTypes.findFirst({
      where: eq(itemTypes.id, id),
    });

    if (!itemType) {
      return res.status(404).json({ error: 'Item type not found' });
    }

    res.json(itemType);
  } catch (error) {
    console.error('Get item type error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create item type
itemTypesRouter.post('/', requireRole('operator', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    const validation = createItemTypeSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const { name, description, tenantId } = validation.data;

    // Check for duplicate name
    const existing = await db.query.itemTypes.findFirst({
      where: eq(itemTypes.name, name.trim()),
    });

    if (existing) {
      return res.status(400).json({ error: 'Bu isimde urun turu zaten mevcut' });
    }

    const [newItemType] = await db.insert(itemTypes).values({
      name: name.trim(),
      description,
      tenantId: tenantId || null,
    }).returning();

    res.status(201).json(newItemType);
  } catch (error) {
    console.error('Create item type error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update item type
itemTypesRouter.patch('/:id', requireRole('operator', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const validation = updateItemTypeSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const existingItemType = await db.query.itemTypes.findFirst({
      where: eq(itemTypes.id, id),
    });

    if (!existingItemType) {
      return res.status(404).json({ error: 'Item type not found' });
    }

    const [updatedItemType] = await db.update(itemTypes)
      .set(validation.data)
      .where(eq(itemTypes.id, id))
      .returning();

    res.json(updatedItemType);
  } catch (error) {
    console.error('Update item type error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete item type
itemTypesRouter.delete('/:id', requireRole('laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const existingItemType = await db.query.itemTypes.findFirst({
      where: eq(itemTypes.id, id),
    });

    if (!existingItemType) {
      return res.status(404).json({ error: 'Item type not found' });
    }

    await db.delete(itemTypes).where(eq(itemTypes.id, id));

    res.json({ message: 'Item type deleted' });
  } catch (error) {
    console.error('Delete item type error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
