import { Router } from 'express';
import { db } from '../db';
import { pickups, pickupItems, items, tenants } from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { requireAuth, AuthRequest, requireRole } from '../middleware/auth';
import { z } from 'zod';

export const pickupsRouter = Router();
pickupsRouter.use(requireAuth);

// Validation schemas
const createPickupSchema = z.object({
  tenantId: z.string().uuid('Invalid tenant ID'),
  bagCode: z.string().min(1, 'Bag code is required'),
  sealNumber: z.string().optional(),
  itemIds: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

// Create pickup
pickupsRouter.post('/', requireRole('driver', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    // Validate request body
    const validation = createPickupSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors
      });
    }

    const { tenantId, bagCode, sealNumber, itemIds, notes } = validation.data;

    // Verify tenant exists
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Create pickup - automatically set as received (driver delivers directly to laundry)
    const [newPickup] = await db.insert(pickups).values({
      tenantId,
      driverId: req.user!.id,
      bagCode,
      sealNumber,
      notes,
      status: 'received', // Auto-receive when driver creates pickup
      receivedDate: new Date(),
    }).returning();

    // Associate items with pickup
    if (itemIds && itemIds.length > 0) {
      await db.insert(pickupItems).values(
        itemIds.map((itemId: string) => ({
          pickupId: newPickup.id,
          itemId,
        }))
      );

      // Update ALL items status to at_laundry
      await db.update(items)
        .set({ status: 'at_laundry', updatedAt: new Date() })
        .where(inArray(items.id, itemIds));
    }

    res.status(201).json(newPickup);
  } catch (error) {
    console.error('Create pickup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all pickups with pagination and filtering
pickupsRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status as string | undefined;

    // Build where conditions for tenant isolation
    const conditions = [];
    if (user.role !== 'system_admin' && user.tenantId) {
      conditions.push(eq(pickups.tenantId, user.tenantId));
    }
    if (status) {
      conditions.push(eq(pickups.status, status as any));
    }

    const allPickups = await db.query.pickups.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      limit,
      offset,
      orderBy: (pickups, { desc }) => [desc(pickups.createdAt)],
      with: {
        tenant: true,
        driver: true,
        pickupItems: {
          with: {
            item: {
              with: {
                itemType: true,
              },
            },
          },
        },
      },
    });

    // Get total count for pagination
    const allCount = await db.query.pickups.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
    });

    res.json({
      data: allPickups,
      pagination: {
        page,
        limit,
        total: allCount.length,
        totalPages: Math.ceil(allCount.length / limit),
      }
    });
  } catch (error) {
    console.error('Get pickups error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single pickup by ID
pickupsRouter.get('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const pickup = await db.query.pickups.findFirst({
      where: eq(pickups.id, id),
      with: {
        tenant: true,
        driver: true,
        pickupItems: {
          with: {
            item: {
              with: {
                itemType: true,
              },
            },
          },
        },
      },
    });

    if (!pickup) {
      return res.status(404).json({ error: 'Pickup not found' });
    }

    // Check tenant access
    if (user.role !== 'system_admin' && user.tenantId && pickup.tenantId !== user.tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(pickup);
  } catch (error) {
    console.error('Get pickup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create pickup from RFID tags (mobile app)
const createPickupFromTagsSchema = z.object({
  tenantId: z.string().uuid('Invalid tenant ID'),
  rfidTags: z.array(z.string()).min(1, 'At least one RFID tag is required'),
  notes: z.string().optional(),
});

pickupsRouter.post('/from-tags', requireRole('driver', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    const validation = createPickupFromTagsSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors
      });
    }

    const { tenantId, rfidTags, notes } = validation.data;

    // Verify tenant exists
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Find items by RFID tags
    const foundItems = await db.query.items.findMany({
      where: inArray(items.rfidTag, rfidTags),
    });

    // Check if any items belong to different tenant
    const wrongTenantItems = foundItems.filter(item => item.tenantId !== tenantId);
    if (wrongTenantItems.length > 0) {
      return res.status(400).json({
        error: 'Some items belong to different hotels',
        wrongItems: wrongTenantItems.map(i => i.rfidTag),
        count: wrongTenantItems.length
      });
    }

    // Get item IDs for registered items
    const itemIds = foundItems.map(item => item.id);

    // Generate bag code automatically
    const bagCode = `PU-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    // Create pickup
    const [newPickup] = await db.insert(pickups).values({
      tenantId,
      driverId: req.user!.id,
      bagCode,
      notes,
      status: 'received',
      receivedDate: new Date(),
    }).returning();

    // Associate items with pickup
    if (itemIds.length > 0) {
      await db.insert(pickupItems).values(
        itemIds.map((itemId: string) => ({
          pickupId: newPickup.id,
          itemId,
        }))
      );

      // Update items status to at_laundry
      await db.update(items)
        .set({ status: 'at_laundry', updatedAt: new Date() })
        .where(inArray(items.id, itemIds));
    }

    res.status(201).json({
      ...newPickup,
      itemCount: itemIds.length,
      scannedTags: rfidTags.length,
      registeredItems: itemIds.length,
      unregisteredTags: rfidTags.length - itemIds.length
    });
  } catch (error) {
    console.error('Create pickup from tags error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Receive dirty items (driver can deliver to laundry, laundry staff can receive)
pickupsRouter.post('/:id/receive', requireRole('driver', 'operator', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Verify pickup exists
    const existingPickup = await db.query.pickups.findFirst({
      where: eq(pickups.id, id),
    });
    if (!existingPickup) {
      return res.status(404).json({ error: 'Pickup not found' });
    }
    if (existingPickup.status !== 'created') {
      return res.status(400).json({ error: 'Pickup already received or processed' });
    }

    const [updatedPickup] = await db.update(pickups)
      .set({
        status: 'received',
        receivedDate: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(pickups.id, id))
      .returning();

    // Update all items in pickup to at_laundry status using batch update
    const pickupItemsList = await db.query.pickupItems.findMany({
      where: eq(pickupItems.pickupId, id),
    });

    if (pickupItemsList.length > 0) {
      const itemIds = pickupItemsList.map(pi => pi.itemId);
      await db.update(items)
        .set({ status: 'at_laundry', updatedAt: new Date() })
        .where(inArray(items.id, itemIds));
    }

    res.json(updatedPickup);
  } catch (error) {
    console.error('Receive pickup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

