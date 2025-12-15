import { Router, Response } from 'express';
import { db } from '../db';
import { waybills, waybillDeliveries, deliveries, items } from '../db/schema';
import { eq, desc, and, inArray } from 'drizzle-orm';
import { requireAuth, AuthRequest } from '../middleware/auth';

export const waybillsRouter = Router();

// Apply auth middleware to all routes
waybillsRouter.use(requireAuth);

// Generate waybill number
function generateWaybillNumber(): string {
  const timestamp = Date.now().toString().slice(-9);
  return `A-${timestamp}`;
}

// Get all waybills (with pagination)
waybillsRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { page = '1', limit = '50', status, tenantId } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    let conditions: any[] = [];

    // Hotel owners can only see their own waybills
    if (user.role === 'hotel_owner' && user.tenantId) {
      conditions.push(eq(waybills.tenantId, user.tenantId));
    } else if (tenantId) {
      conditions.push(eq(waybills.tenantId, tenantId as string));
    }

    if (status) {
      conditions.push(eq(waybills.status, status as any));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [waybillList, countResult] = await Promise.all([
      db.query.waybills.findMany({
        where: whereClause,
        with: {
          tenant: true,
          printedByUser: true,
          waybillDeliveries: {
            with: {
              delivery: {
                with: {
                  deliveryItems: {
                    with: {
                      item: {
                        with: {
                          itemType: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: [desc(waybills.createdAt)],
        limit: limitNum,
        offset,
      }),
      db.select().from(waybills).where(whereClause),
    ]);

    res.json({
      data: waybillList,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countResult.length,
        totalPages: Math.ceil(countResult.length / limitNum),
      },
    });
  } catch (error) {
    console.error('Error fetching waybills:', error);
    res.status(500).json({ error: 'Failed to fetch waybills' });
  }
});

// Get single waybill
waybillsRouter.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const waybill = await db.query.waybills.findFirst({
      where: eq(waybills.id, id),
      with: {
        tenant: true,
        printedByUser: true,
        waybillDeliveries: {
          with: {
            delivery: {
              with: {
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
            },
          },
        },
      },
    });

    if (!waybill) {
      return res.status(404).json({ error: 'Waybill not found' });
    }

    res.json(waybill);
  } catch (error) {
    console.error('Error fetching waybill:', error);
    res.status(500).json({ error: 'Failed to fetch waybill' });
  }
});

// Create new waybill (from selected delivery IDs)
waybillsRouter.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { deliveryIds, bagCount = 0, notes } = req.body;

    if (!deliveryIds || !Array.isArray(deliveryIds) || deliveryIds.length === 0) {
      return res.status(400).json({ error: 'deliveryIds array is required' });
    }

    // Get all deliveries
    const deliveryList = await db.query.deliveries.findMany({
      where: inArray(deliveries.id, deliveryIds),
      with: {
        deliveryItems: {
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

    if (deliveryList.length === 0) {
      return res.status(400).json({ error: 'No valid deliveries found' });
    }

    // Verify all deliveries belong to same tenant
    const tenantIds = [...new Set(deliveryList.map(d => d.tenantId))];
    if (tenantIds.length > 1) {
      return res.status(400).json({ error: 'All deliveries must belong to the same hotel' });
    }

    const tenantId = tenantIds[0];

    // Calculate item summary
    const itemSummary: Record<string, { typeName: string; count: number }> = {};
    let totalItems = 0;

    deliveryList.forEach(delivery => {
      // First try notes (labelExtraData)
      if (delivery.notes) {
        try {
          const labelData = JSON.parse(delivery.notes);
          if (Array.isArray(labelData)) {
            labelData.forEach((item: any) => {
              const typeName = item.typeName || 'Bilinmeyen';
              const count = item.count || 0;
              if (!itemSummary[typeName]) {
                itemSummary[typeName] = { typeName, count: 0 };
              }
              itemSummary[typeName].count += count;
              totalItems += count;
            });
            return;
          }
        } catch {}
      }

      // Fallback to deliveryItems
      delivery.deliveryItems?.forEach((di: any) => {
        const typeName = di.item?.itemType?.name || 'Bilinmeyen';
        if (!itemSummary[typeName]) {
          itemSummary[typeName] = { typeName, count: 0 };
        }
        itemSummary[typeName].count++;
        totalItems++;
      });
    });

    const waybillNumber = generateWaybillNumber();

    // Create waybill
    const [newWaybill] = await db.insert(waybills).values({
      tenantId,
      waybillNumber,
      status: 'printed',
      packageCount: deliveryList.length,
      bagCount,
      totalItems,
      itemSummary: JSON.stringify(Object.values(itemSummary)),
      printedAt: new Date(),
      printedBy: user.id,
      notes,
    }).returning();

    // Link deliveries to waybill
    await db.insert(waybillDeliveries).values(
      deliveryIds.map((deliveryId: string) => ({
        waybillId: newWaybill.id,
        deliveryId,
      }))
    );

    // Update delivery statuses to picked_up
    await db.update(deliveries)
      .set({
        status: 'picked_up',
        pickedUpAt: new Date(),
        updatedAt: new Date(),
      })
      .where(inArray(deliveries.id, deliveryIds));

    // Update item statuses to in_transit
    const allItemIds = deliveryList.flatMap(d =>
      d.deliveryItems?.map(di => di.itemId) || []
    );

    if (allItemIds.length > 0) {
      await db.update(items)
        .set({
          status: 'in_transit',
          updatedAt: new Date(),
        })
        .where(inArray(items.id, allItemIds));
    }

    // Fetch created waybill with relations
    const createdWaybill = await db.query.waybills.findFirst({
      where: eq(waybills.id, newWaybill.id),
      with: {
        tenant: true,
        printedByUser: true,
        waybillDeliveries: {
          with: {
            delivery: true,
          },
        },
      },
    });

    res.status(201).json(createdWaybill);
  } catch (error) {
    console.error('Error creating waybill:', error);
    res.status(500).json({ error: 'Failed to create waybill' });
  }
});

// Mark waybill as delivered
waybillsRouter.post('/:id/deliver', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const waybill = await db.query.waybills.findFirst({
      where: eq(waybills.id, id),
      with: {
        waybillDeliveries: {
          with: {
            delivery: {
              with: {
                deliveryItems: true,
              },
            },
          },
        },
      },
    });

    if (!waybill) {
      return res.status(404).json({ error: 'Waybill not found' });
    }

    // Update waybill status
    await db.update(waybills)
      .set({
        status: 'delivered',
        deliveredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(waybills.id, id));

    // Update all deliveries to delivered
    const deliveryIds = waybill.waybillDeliveries.map(wd => wd.deliveryId);
    await db.update(deliveries)
      .set({
        status: 'delivered',
        deliveredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(inArray(deliveries.id, deliveryIds));

    // Update all items to at_hotel
    const allItemIds = waybill.waybillDeliveries.flatMap(wd =>
      wd.delivery.deliveryItems?.map(di => di.itemId) || []
    );

    if (allItemIds.length > 0) {
      await db.update(items)
        .set({
          status: 'at_hotel',
          updatedAt: new Date(),
        })
        .where(inArray(items.id, allItemIds));
    }

    res.json({ success: true, message: 'Waybill marked as delivered' });
  } catch (error) {
    console.error('Error marking waybill as delivered:', error);
    res.status(500).json({ error: 'Failed to mark waybill as delivered' });
  }
});
