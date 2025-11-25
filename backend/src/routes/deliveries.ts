import { Router } from 'express';
import { db } from '../db';
import { deliveries, deliveryItems, deliveryPackages, items, tenants, users } from '../db/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { requireAuth, AuthRequest, requireRole } from '../middleware/auth';
import { z } from 'zod';
import { sendDeliveryNotification } from '../services/email';

export const deliveriesRouter = Router();
deliveriesRouter.use(requireAuth);

// Validation schemas
const createDeliverySchema = z.object({
  tenantId: z.string().uuid('Invalid tenant ID'),
  itemIds: z.array(z.string().uuid()).min(1, 'At least one item is required'),
  packageCount: z.number().int().min(1, 'Package count must be at least 1').default(1),
  notes: z.string().optional(),
});

// Create delivery
deliveriesRouter.post('/', requireRole('operator', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    const validation = createDeliverySchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors
      });
    }

    const { tenantId, itemIds, packageCount, notes } = validation.data;

    // Verify tenant exists
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Verify all items exist and are ready for delivery
    const itemsToDeliver = await db.query.items.findMany({
      where: inArray(items.id, itemIds),
    });

    if (itemsToDeliver.length !== itemIds.length) {
      return res.status(400).json({ error: 'Some items not found' });
    }

    const notReadyItems = itemsToDeliver.filter(item => item.status !== 'ready_for_delivery');
    if (notReadyItems.length > 0) {
      return res.status(400).json({
        error: 'Some items are not ready for delivery',
        items: notReadyItems.map(i => i.rfidTag)
      });
    }

    // Generate unique barcode
    const barcode = `DEL-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    // Create delivery
    const [newDelivery] = await db.insert(deliveries).values({
      tenantId,
      barcode,
      packageCount,
      notes,
    }).returning();

    // Associate items with delivery
    await db.insert(deliveryItems).values(
      itemIds.map((itemId: string) => ({
        deliveryId: newDelivery.id,
        itemId,
      }))
    );

    // Create delivery packages
    const packageInserts = [];
    for (let i = 1; i <= packageCount; i++) {
      const packageBarcode = `${barcode}-PKG${i}`;
      packageInserts.push({
        deliveryId: newDelivery.id,
        packageBarcode,
        sequenceNumber: i,
      });
    }
    await db.insert(deliveryPackages).values(packageInserts);

    // Get delivery with relations
    const deliveryWithRelations = await db.query.deliveries.findFirst({
      where: eq(deliveries.id, newDelivery.id),
      with: {
        tenant: true,
        deliveryItems: {
          with: {
            item: {
              with: {
                itemType: true,
              },
            },
          },
        },
        deliveryPackages: true,
      },
    });

    res.status(201).json(deliveryWithRelations);
  } catch (error) {
    console.error('Create delivery error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all deliveries with pagination
deliveriesRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status as string | undefined;

    // Build where conditions
    const conditions = [];
    if (user.role !== 'system_admin' && user.tenantId) {
      conditions.push(eq(deliveries.tenantId, user.tenantId));
    }
    if (status) {
      conditions.push(eq(deliveries.status, status as any));
    }

    const allDeliveries = await db.query.deliveries.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      limit,
      offset,
      orderBy: [desc(deliveries.createdAt)],
      with: {
        tenant: true,
        driver: true,
        packager: true,
        deliveryItems: {
          with: {
            item: {
              with: {
                itemType: true,
              },
            },
          },
        },
        deliveryPackages: true,
      },
    });

    // Get total count
    const totalCount = await db.query.deliveries.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
    });

    res.json({
      data: allDeliveries,
      pagination: {
        page,
        limit,
        total: totalCount.length,
        totalPages: Math.ceil(totalCount.length / limit),
      }
    });
  } catch (error) {
    console.error('Get deliveries error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single delivery by ID
deliveriesRouter.get('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const delivery = await db.query.deliveries.findFirst({
      where: eq(deliveries.id, id),
      with: {
        tenant: true,
        driver: true,
        packager: true,
        deliveryItems: {
          with: {
            item: {
              with: {
                itemType: true,
              },
            },
          },
        },
        deliveryPackages: true,
      },
    });

    if (!delivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }

    // Check tenant access
    if (user.role !== 'system_admin' && user.tenantId && delivery.tenantId !== user.tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(delivery);
  } catch (error) {
    console.error('Get delivery error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get delivery by barcode
deliveriesRouter.get('/barcode/:barcode', async (req: AuthRequest, res) => {
  try {
    const { barcode } = req.params;
    const user = req.user!;

    const delivery = await db.query.deliveries.findFirst({
      where: eq(deliveries.barcode, barcode),
      with: {
        tenant: true,
        driver: true,
        packager: true,
        deliveryItems: {
          with: {
            item: {
              with: {
                itemType: true,
              },
            },
          },
        },
        deliveryPackages: true,
      },
    });

    if (!delivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }

    // Check tenant access
    if (user.role !== 'system_admin' && user.tenantId && delivery.tenantId !== user.tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(delivery);
  } catch (error) {
    console.error('Get delivery by barcode error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Print label
deliveriesRouter.post('/:id/print-label', requireRole('operator', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Verify delivery exists
    const existingDelivery = await db.query.deliveries.findFirst({
      where: eq(deliveries.id, id),
    });
    if (!existingDelivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }
    if (existingDelivery.status !== 'created') {
      return res.status(400).json({ error: 'Label already printed or delivery in progress' });
    }

    const [updatedDelivery] = await db.update(deliveries)
      .set({
        status: 'label_printed',
        labelPrintedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(deliveries.id, id))
      .returning();

    // Update items status using batch update
    const deliveryItemsList = await db.query.deliveryItems.findMany({
      where: eq(deliveryItems.deliveryId, id),
    });

    if (deliveryItemsList.length > 0) {
      const itemIds = deliveryItemsList.map(di => di.itemId);
      await db.update(items)
        .set({ status: 'label_printed', updatedAt: new Date() })
        .where(inArray(items.id, itemIds));
    }

    // Return updated delivery with relations
    const deliveryWithRelations = await db.query.deliveries.findFirst({
      where: eq(deliveries.id, id),
      with: {
        tenant: true,
        deliveryItems: {
          with: {
            item: {
              with: {
                itemType: true,
              },
            },
          },
        },
        deliveryPackages: true,
      },
    });

    res.json(deliveryWithRelations);
  } catch (error) {
    console.error('Print label error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Package delivery
deliveriesRouter.post('/:id/package', requireRole('packager', 'operator', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Verify delivery exists
    const existingDelivery = await db.query.deliveries.findFirst({
      where: eq(deliveries.id, id),
    });
    if (!existingDelivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }
    if (existingDelivery.status !== 'label_printed') {
      return res.status(400).json({ error: 'Delivery must have label printed first' });
    }

    const [updatedDelivery] = await db.update(deliveries)
      .set({
        status: 'packaged',
        packagerId: req.user!.id,
        packagedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(deliveries.id, id))
      .returning();

    // Update items status using batch update
    const deliveryItemsList = await db.query.deliveryItems.findMany({
      where: eq(deliveryItems.deliveryId, id),
    });

    if (deliveryItemsList.length > 0) {
      const itemIds = deliveryItemsList.map(di => di.itemId);
      await db.update(items)
        .set({ status: 'packaged', updatedAt: new Date() })
        .where(inArray(items.id, itemIds));
    }

    // Return updated delivery with relations
    const deliveryWithRelations = await db.query.deliveries.findFirst({
      where: eq(deliveries.id, id),
      with: {
        tenant: true,
        packager: true,
        deliveryItems: {
          with: {
            item: {
              with: {
                itemType: true,
              },
            },
          },
        },
        deliveryPackages: true,
      },
    });

    res.json(deliveryWithRelations);
  } catch (error) {
    console.error('Package delivery error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Pick up delivery (driver)
deliveriesRouter.post('/:id/pickup', requireRole('driver', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Verify delivery exists
    const existingDelivery = await db.query.deliveries.findFirst({
      where: eq(deliveries.id, id),
    });
    if (!existingDelivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }
    if (existingDelivery.status !== 'packaged') {
      return res.status(400).json({ error: 'Delivery must be packaged first' });
    }

    const [updatedDelivery] = await db.update(deliveries)
      .set({
        status: 'picked_up',
        driverId: req.user!.id,
        pickedUpAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(deliveries.id, id))
      .returning();

    // Update items status
    const deliveryItemsList = await db.query.deliveryItems.findMany({
      where: eq(deliveryItems.deliveryId, id),
    });

    if (deliveryItemsList.length > 0) {
      const itemIds = deliveryItemsList.map(di => di.itemId);
      await db.update(items)
        .set({ status: 'in_transit', updatedAt: new Date() })
        .where(inArray(items.id, itemIds));
    }

    res.json(updatedDelivery);
  } catch (error) {
    console.error('Pickup delivery error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Deliver to hotel
deliveriesRouter.post('/:id/deliver', requireRole('driver', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Verify delivery exists
    const existingDelivery = await db.query.deliveries.findFirst({
      where: eq(deliveries.id, id),
      with: {
        tenant: true,
      },
    });
    if (!existingDelivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }
    if (existingDelivery.status !== 'picked_up') {
      return res.status(400).json({ error: 'Delivery must be picked up first' });
    }

    const [updatedDelivery] = await db.update(deliveries)
      .set({
        status: 'delivered',
        driverId: req.user!.id,
        deliveredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(deliveries.id, id))
      .returning();

    // Update items status and increment wash count
    const deliveryItemsList = await db.query.deliveryItems.findMany({
      where: eq(deliveryItems.deliveryId, id),
    });

    for (const deliveryItem of deliveryItemsList) {
      const item = await db.query.items.findFirst({
        where: eq(items.id, deliveryItem.itemId),
      });

      if (item) {
        await db.update(items)
          .set({
            status: 'at_hotel',
            washCount: item.washCount + 1,
            lastWashDate: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(items.id, deliveryItem.itemId));
      }
    }

    // Send email notification to hotel owner
    try {
      if (existingDelivery.tenant?.email) {
        await sendDeliveryNotification(
          existingDelivery.tenant.email,
          existingDelivery.tenant.name,
          updatedDelivery.barcode,
          deliveryItemsList.length
        );
      }
    } catch (emailError) {
      console.error('Failed to send delivery notification:', emailError);
      // Don't fail the request if email fails
    }

    // Return updated delivery with relations
    const deliveryWithRelations = await db.query.deliveries.findFirst({
      where: eq(deliveries.id, id),
      with: {
        tenant: true,
        driver: true,
        packager: true,
        deliveryItems: {
          with: {
            item: {
              with: {
                itemType: true,
              },
            },
          },
        },
        deliveryPackages: true,
      },
    });

    res.json(deliveryWithRelations);
  } catch (error) {
    console.error('Deliver error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cancel delivery
deliveriesRouter.post('/:id/cancel', requireRole('laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Verify delivery exists
    const existingDelivery = await db.query.deliveries.findFirst({
      where: eq(deliveries.id, id),
    });
    if (!existingDelivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }
    if (existingDelivery.status === 'delivered') {
      return res.status(400).json({ error: 'Cannot cancel delivered delivery' });
    }

    // Get items and reset their status
    const deliveryItemsList = await db.query.deliveryItems.findMany({
      where: eq(deliveryItems.deliveryId, id),
    });

    if (deliveryItemsList.length > 0) {
      const itemIds = deliveryItemsList.map(di => di.itemId);
      await db.update(items)
        .set({ status: 'ready_for_delivery', updatedAt: new Date() })
        .where(inArray(items.id, itemIds));
    }

    // Delete delivery items
    await db.delete(deliveryItems).where(eq(deliveryItems.deliveryId, id));

    // Delete delivery
    await db.delete(deliveries).where(eq(deliveries.id, id));

    res.json({ message: 'Delivery cancelled' });
  } catch (error) {
    console.error('Cancel delivery error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
