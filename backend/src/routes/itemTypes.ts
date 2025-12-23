import { Router } from 'express';
import { db } from '../db';
import { itemTypes } from '../db/schema';
import { eq, inArray, sql, max } from 'drizzle-orm';
import { requireAuth, AuthRequest, requireRole } from '../middleware/auth';
import { z } from 'zod';

export const itemTypesRouter = Router();
// NOTE: Auth is applied per-route, not globally, so GET / can be public

const createItemTypeSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  tenantId: z.string().uuid().optional(),
});

const updateItemTypeSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});

// Get all item types - PUBLIC but with minimal data (no auth required for station apps)
// Only returns essential fields to avoid exposing sensitive information
itemTypesRouter.get('/', async (req, res) => {
  try {
    const allItemTypes = await db.query.itemTypes.findMany({
      orderBy: (itemTypes, { asc }) => [asc(itemTypes.sortOrder), asc(itemTypes.name)],
      columns: {
        id: true,
        name: true,
        description: true,
        sortOrder: true,
      },
    });
    res.json(allItemTypes);
  } catch (error) {
    console.error('Get item types error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get item type by ID - requires auth
itemTypesRouter.get('/:id', requireAuth, async (req: AuthRequest, res) => {
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

// Create item type - requires auth
itemTypesRouter.post('/', requireAuth, requireRole('operator', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
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

    // Get max sortOrder and add 1
    const maxSortResult = await db.select({ maxSort: max(itemTypes.sortOrder) }).from(itemTypes);
    const nextSortOrder = (maxSortResult[0]?.maxSort ?? -1) + 1;

    const [newItemType] = await db.insert(itemTypes).values({
      name: name.trim(),
      description,
      tenantId: tenantId || null,
      sortOrder: nextSortOrder,
    }).returning();

    res.status(201).json(newItemType);
  } catch (error) {
    console.error('Create item type error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update item type - requires auth
itemTypesRouter.patch('/:id', requireAuth, requireRole('operator', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
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

// Delete item type - requires auth
itemTypesRouter.delete('/:id', requireAuth, requireRole('laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
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

// Reorder item types - requires admin
const reorderSchema = z.object({
  orderedIds: z.array(z.string().uuid()),
});

itemTypesRouter.post('/reorder', requireAuth, requireRole('laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    const validation = reorderSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const { orderedIds } = validation.data;

    // Update sortOrder for each item type based on position in array
    for (let i = 0; i < orderedIds.length; i++) {
      await db.update(itemTypes)
        .set({ sortOrder: i })
        .where(eq(itemTypes.id, orderedIds[i]));
    }

    // Return updated list
    const updatedItemTypes = await db.query.itemTypes.findMany({
      orderBy: (itemTypes, { asc }) => [asc(itemTypes.sortOrder), asc(itemTypes.name)],
    });

    res.json(updatedItemTypes);
  } catch (error) {
    console.error('Reorder item types error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
