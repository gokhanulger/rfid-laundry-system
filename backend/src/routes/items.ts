import { Router } from 'express';
import { db } from '../db';
import { items, itemTypes, tenants } from '../db/schema';
import { eq, and, inArray, desc, sql, like, gt, gte } from 'drizzle-orm';
import { requireAuth, AuthRequest, requireRole } from '../middleware/auth';
import { z } from 'zod';

export const itemsRouter = Router();
itemsRouter.use(requireAuth);

// Validation schemas
const itemStatusEnum = z.enum([
  'at_hotel', 'at_laundry', 'processing', 'ready_for_delivery',
  'label_printed', 'packaged', 'in_transit', 'delivered'
]);

const createItemSchema = z.object({
  rfidTag: z.string().min(1, 'RFID tag is required'),
  itemTypeId: z.string().uuid('Invalid item type ID'),
  tenantId: z.string().uuid('Invalid tenant ID'),
  status: itemStatusEnum.optional().default('at_laundry'),
  location: z.string().optional().default('laundry'),
  notes: z.string().optional(),
});

const updateItemSchema = z.object({
  status: itemStatusEnum.optional(),
  location: z.string().optional(),
  isDamaged: z.boolean().optional(),
  isStained: z.boolean().optional(),
  notes: z.string().optional(),
});

const markCleanSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1, 'At least one item ID is required'),
});

const scanSchema = z.object({
  rfidTags: z.array(z.string()).min(1, 'At least one RFID tag is required'),
});

// Get all items with pagination and filtering
// Supports delta sync with updatedSince parameter
itemsRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const { status, tenantId, search, itemTypeId, updatedSince } = req.query;
    const user = req.user!;
    const page = parseInt(req.query.page as string) || 1;
    // Allow up to 1000 items per page for sync efficiency
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 1000);
    const offset = (page - 1) * limit;

    // Build where conditions
    const conditions = [];

    // Tenant isolation
    if (user.role !== 'system_admin' && user.tenantId) {
      conditions.push(eq(items.tenantId, user.tenantId));
    } else if (tenantId) {
      conditions.push(eq(items.tenantId, tenantId as string));
    }

    // Filter by status
    if (status) {
      conditions.push(eq(items.status, status as any));
    }

    // Filter by item type
    if (itemTypeId) {
      conditions.push(eq(items.itemTypeId, itemTypeId as string));
    }

    // Search by RFID tag
    if (search && typeof search === 'string') {
      conditions.push(like(items.rfidTag, `%${search}%`));
    }

    // Delta sync: only items updated after a certain time
    if (updatedSince && typeof updatedSince === 'string') {
      const sinceDate = new Date(updatedSince);
      if (!isNaN(sinceDate.getTime())) {
        conditions.push(gte(items.updatedAt, sinceDate));
      }
    }

    const allItems = await db.query.items.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      limit,
      offset,
      orderBy: [desc(items.updatedAt)],
      with: {
        itemType: true,
        tenant: true,
      },
    });

    // Get total count for pagination
    const totalCount = await db.query.items.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
    });

    res.json({
      data: allItems,
      pagination: {
        page,
        limit,
        total: totalCount.length,
        totalPages: Math.ceil(totalCount.length / limit),
      }
    });
  } catch (error) {
    console.error('Get items error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get item by RFID tag (case-insensitive search)
itemsRouter.get('/rfid/:rfidTag', async (req: AuthRequest, res) => {
  try {
    const { rfidTag } = req.params;
    const user = req.user!;

    // Try exact match first, then case-insensitive
    let item = await db.query.items.findFirst({
      where: eq(items.rfidTag, rfidTag),
      with: {
        itemType: true,
        tenant: true,
      },
    });

    // If not found, try uppercase
    if (!item) {
      item = await db.query.items.findFirst({
        where: eq(items.rfidTag, rfidTag.toUpperCase()),
        with: {
          itemType: true,
          tenant: true,
        },
      });
    }

    // If still not found, try lowercase
    if (!item) {
      item = await db.query.items.findFirst({
        where: eq(items.rfidTag, rfidTag.toLowerCase()),
        with: {
          itemType: true,
          tenant: true,
        },
      });
    }

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Check tenant access
    if (user.role !== 'system_admin' && user.tenantId && item.tenantId !== user.tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(item);
  } catch (error) {
    console.error('Get item by RFID error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get dirty items (for dropdown selection) - MUST be before /:id
itemsRouter.get('/status/dirty', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const tenantId = req.query.tenantId as string | undefined;

    // Build where conditions
    const conditions: any[] = [
      inArray(items.status, ['at_laundry', 'processing'] as any[])
    ];

    if (user.role !== 'system_admin' && user.tenantId) {
      conditions.push(eq(items.tenantId, user.tenantId));
    } else if (tenantId) {
      conditions.push(eq(items.tenantId, tenantId));
    }

    // Get dirty items (status: at_laundry or processing)
    const dirtyItems = await db.query.items.findMany({
      where: and(...conditions),
      orderBy: [desc(items.updatedAt)],
      with: {
        itemType: true,
        tenant: true,
      },
    });

    res.json(dirtyItems);
  } catch (error) {
    console.error('Get dirty items error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get items ready for delivery
itemsRouter.get('/status/ready', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const tenantId = req.query.tenantId as string | undefined;

    const conditions: any[] = [
      eq(items.status, 'ready_for_delivery')
    ];

    if (user.role !== 'system_admin' && user.tenantId) {
      conditions.push(eq(items.tenantId, user.tenantId));
    } else if (tenantId) {
      conditions.push(eq(items.tenantId, tenantId));
    }

    const readyItems = await db.query.items.findMany({
      where: and(...conditions),
      orderBy: [desc(items.updatedAt)],
      with: {
        itemType: true,
        tenant: true,
      },
    });

    res.json(readyItems);
  } catch (error) {
    console.error('Get ready items error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get item by ID - MUST be after /status/* routes
itemsRouter.get('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const item = await db.query.items.findFirst({
      where: eq(items.id, id),
      with: {
        itemType: true,
        tenant: true,
      },
    });

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Check tenant access
    if (user.role !== 'system_admin' && user.tenantId && item.tenantId !== user.tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(item);
  } catch (error) {
    console.error('Get item by ID error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create item
itemsRouter.post('/', requireRole('driver', 'operator', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    const validation = createItemSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors
      });
    }

    const { rfidTag, itemTypeId, tenantId, status, location, notes } = validation.data;

    // Check if RFID tag already exists
    const existingItem = await db.query.items.findFirst({
      where: eq(items.rfidTag, rfidTag),
    });
    if (existingItem) {
      return res.status(400).json({ error: 'RFID tag already exists' });
    }

    // Verify tenant exists
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Verify item type exists
    const itemType = await db.query.itemTypes.findFirst({
      where: eq(itemTypes.id, itemTypeId),
    });
    if (!itemType) {
      return res.status(404).json({ error: 'Item type not found' });
    }

    const [newItem] = await db.insert(items).values({
      rfidTag,
      itemTypeId,
      tenantId,
      status: status || 'at_laundry',
      location: location || 'laundry',
      notes,
    }).returning();

    const itemWithRelations = await db.query.items.findFirst({
      where: eq(items.id, newItem.id),
      with: {
        itemType: true,
        tenant: true,
      },
    });

    res.status(201).json(itemWithRelations);
  } catch (error) {
    console.error('Create item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark items as clean (bulk update)
itemsRouter.post('/mark-clean', requireRole('operator', 'laundry_manager', 'system_admin', 'ironer'), async (req: AuthRequest, res) => {
  try {
    const validation = markCleanSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors
      });
    }

    const { itemIds } = validation.data;

    // Update items to ready_for_delivery status
    await db.update(items)
      .set({
        status: 'ready_for_delivery',
        updatedAt: new Date(),
      })
      .where(inArray(items.id, itemIds));

    // Get updated items
    const updatedItems = await db.query.items.findMany({
      where: inArray(items.id, itemIds),
      with: {
        itemType: true,
        tenant: true,
      },
    });

    res.json({ message: 'Items marked as clean', items: updatedItems, count: updatedItems.length });
  } catch (error) {
    console.error('Mark items clean error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update item
itemsRouter.patch('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const validation = updateItemSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors
      });
    }

    // Verify item exists
    const existingItem = await db.query.items.findFirst({
      where: eq(items.id, id),
    });
    if (!existingItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Check tenant access
    if (user.role !== 'system_admin' && user.tenantId && existingItem.tenantId !== user.tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await db.update(items)
      .set({
        ...validation.data,
        updatedAt: new Date(),
      })
      .where(eq(items.id, id));

    const updatedItem = await db.query.items.findFirst({
      where: eq(items.id, id),
      with: {
        itemType: true,
        tenant: true,
      },
    });

    res.json(updatedItem);
  } catch (error) {
    console.error('Update item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update item status
itemsRouter.patch('/:id/status', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const statusValidation = z.object({ status: itemStatusEnum }).safeParse(req.body);
    if (!statusValidation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: statusValidation.error.errors
      });
    }

    const { status } = statusValidation.data;

    // Verify item exists
    const existingItem = await db.query.items.findFirst({
      where: eq(items.id, id),
    });
    if (!existingItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Check tenant access
    if (user.role !== 'system_admin' && user.tenantId && existingItem.tenantId !== user.tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await db.update(items)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(items.id, id));

    const updatedItem = await db.query.items.findFirst({
      where: eq(items.id, id),
      with: {
        itemType: true,
        tenant: true,
      },
    });

    res.json(updatedItem);
  } catch (error) {
    console.error('Update item status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Scan RFID (bulk)
itemsRouter.post('/scan', async (req: AuthRequest, res) => {
  try {
    const validation = scanSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors
      });
    }

    const { rfidTags } = validation.data;
    const user = req.user!;

    const conditions = [inArray(items.rfidTag, rfidTags)];

    // Tenant isolation
    if (user.role !== 'system_admin' && user.tenantId) {
      conditions.push(eq(items.tenantId, user.tenantId));
    }

    const scannedItems = await db.query.items.findMany({
      where: and(...conditions),
      with: {
        itemType: true,
        tenant: true,
      },
    });

    // Return info about found and not found tags
    const foundTags = scannedItems.map(item => item.rfidTag);
    const notFoundTags = rfidTags.filter(tag => !foundTags.includes(tag));

    res.json({
      items: scannedItems,
      found: foundTags.length,
      notFound: notFoundTags.length,
      notFoundTags,
    });
  } catch (error) {
    console.error('Scan RFID error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark item as damaged
itemsRouter.patch('/:id/damaged', requireRole('operator', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { isDamaged, notes } = req.body;

    const existingItem = await db.query.items.findFirst({
      where: eq(items.id, id),
    });
    if (!existingItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    await db.update(items)
      .set({
        isDamaged: isDamaged ?? true,
        notes: notes || existingItem.notes,
        updatedAt: new Date(),
      })
      .where(eq(items.id, id));

    const updatedItem = await db.query.items.findFirst({
      where: eq(items.id, id),
      with: {
        itemType: true,
        tenant: true,
      },
    });

    res.json(updatedItem);
  } catch (error) {
    console.error('Mark item damaged error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark item as stained
itemsRouter.patch('/:id/stained', requireRole('operator', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { isStained, notes } = req.body;

    const existingItem = await db.query.items.findFirst({
      where: eq(items.id, id),
    });
    if (!existingItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    await db.update(items)
      .set({
        isStained: isStained ?? true,
        notes: notes || existingItem.notes,
        updatedAt: new Date(),
      })
      .where(eq(items.id, id));

    const updatedItem = await db.query.items.findFirst({
      where: eq(items.id, id),
      with: {
        itemType: true,
        tenant: true,
      },
    });

    res.json(updatedItem);
  } catch (error) {
    console.error('Mark item stained error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk create items
itemsRouter.post('/bulk', requireRole('driver', 'operator', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    const bulkSchema = z.object({
      items: z.array(createItemSchema).min(1, 'At least one item is required'),
    });

    const validation = bulkSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors
      });
    }

    const { items: itemsToCreate } = validation.data;
    let created = 0;
    let failed = 0;
    const errors: { rfidTag: string; error: string }[] = [];

    for (const itemData of itemsToCreate) {
      try {
        // Check if RFID tag already exists
        const existingItem = await db.query.items.findFirst({
          where: eq(items.rfidTag, itemData.rfidTag),
        });

        if (existingItem) {
          failed++;
          errors.push({ rfidTag: itemData.rfidTag, error: 'RFID tag already exists' });
          continue;
        }

        // Create item
        await db.insert(items).values({
          rfidTag: itemData.rfidTag,
          itemTypeId: itemData.itemTypeId,
          tenantId: itemData.tenantId,
          status: itemData.status || 'at_laundry',
          location: itemData.location || 'laundry',
          notes: itemData.notes,
        });

        created++;
      } catch (err: any) {
        failed++;
        errors.push({ rfidTag: itemData.rfidTag, error: err.message || 'Unknown error' });
      }
    }

    res.status(201).json({
      created,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Bulk create items error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete item
itemsRouter.delete('/:id', requireRole('laundry_manager', 'system_admin', 'admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const existingItem = await db.query.items.findFirst({
      where: eq(items.id, id),
    });
    if (!existingItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Check tenant access
    if (user.role !== 'system_admin' && user.tenantId && existingItem.tenantId !== user.tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await db.delete(items).where(eq(items.id, id));

    res.json({ message: 'Item deleted' });
  } catch (error) {
    console.error('Delete item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
