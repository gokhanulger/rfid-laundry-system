import { Router } from 'express';
import { db } from '../db';
import { items, pickups, deliveries, waybills, waybillDeliveries, deliveryItems, pickupItems, tenants } from '../db/schema';
import { eq, and, desc, sql, count, gte, lte } from 'drizzle-orm';
import { requireAuth, AuthRequest, requireRole } from '../middleware/auth';

export const portalRouter = Router();

// All portal routes require hotel_owner role
portalRouter.use(requireAuth);
portalRouter.use(requireRole('hotel_owner', 'system_admin'));

// Get portal summary - comprehensive hotel overview
portalRouter.get('/summary', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const tenantId = user.tenantId;

    if (!tenantId && user.role !== 'system_admin') {
      return res.status(403).json({ error: 'No tenant associated with this account' });
    }

    const tenantCondition = tenantId ? eq(items.tenantId, tenantId) : undefined;

    // Get hotel info
    const hotel = tenantId ? await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    }) : null;

    // Get all items for the hotel
    const hotelItems = await db.query.items.findMany({
      where: tenantCondition,
      with: {
        itemType: true,
      },
    });

    // Items by status
    const itemsByStatus = hotelItems.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Today's date boundaries
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // This week boundaries
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    // This month boundaries
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    // Delivery conditions
    const deliveryCondition = tenantId ? eq(deliveries.tenantId, tenantId) : undefined;
    const pickupCondition = tenantId ? eq(pickups.tenantId, tenantId) : undefined;

    // Helper to build conditions safely (filters out undefined)
    const buildConditions = (...conditions: any[]) => {
      const validConditions = conditions.filter(c => c !== undefined && c !== null);
      return validConditions.length > 0 ? and(...validConditions) : undefined;
    };

    // Get delivery stats
    const [todayDeliveries, weekDeliveries, monthDeliveries, totalDeliveries] = await Promise.all([
      db.select({ count: count() }).from(deliveries).where(buildConditions(
        deliveryCondition,
        eq(deliveries.status, 'delivered'),
        gte(deliveries.deliveredAt, today),
        lte(deliveries.deliveredAt, tomorrow)
      )),
      db.select({ count: count() }).from(deliveries).where(buildConditions(
        deliveryCondition,
        eq(deliveries.status, 'delivered'),
        gte(deliveries.deliveredAt, weekStart),
        lte(deliveries.deliveredAt, weekEnd)
      )),
      db.select({ count: count() }).from(deliveries).where(buildConditions(
        deliveryCondition,
        eq(deliveries.status, 'delivered'),
        gte(deliveries.deliveredAt, monthStart),
        lte(deliveries.deliveredAt, monthEnd)
      )),
      db.select({ count: count() }).from(deliveries).where(deliveryCondition),
    ]);

    // Get pickup stats
    const [todayPickups, weekPickups, monthPickups, totalPickups] = await Promise.all([
      db.select({ count: count() }).from(pickups).where(buildConditions(
        pickupCondition,
        gte(pickups.createdAt, today),
        lte(pickups.createdAt, tomorrow)
      )),
      db.select({ count: count() }).from(pickups).where(buildConditions(
        pickupCondition,
        gte(pickups.createdAt, weekStart),
        lte(pickups.createdAt, weekEnd)
      )),
      db.select({ count: count() }).from(pickups).where(buildConditions(
        pickupCondition,
        gte(pickups.createdAt, monthStart),
        lte(pickups.createdAt, monthEnd)
      )),
      db.select({ count: count() }).from(pickups).where(pickupCondition),
    ]);

    // Get pending deliveries (in transit)
    const pendingDeliveries = await db.query.deliveries.findMany({
      where: buildConditions(
        deliveryCondition,
        sql`${deliveries.status} IN ('packaged', 'in_transit', 'picked_up')`
      ),
      orderBy: [desc(deliveries.createdAt)],
      limit: 5,
      with: {
        driver: true,
      },
    });

    // Items needing attention
    const attentionItems = hotelItems
      .filter(i => i.isDamaged || i.isStained || i.washCount > 50)
      .slice(0, 10)
      .map(item => ({
        id: item.id,
        rfidTag: item.rfidTag,
        itemType: item.itemType?.name,
        status: item.status,
        washCount: item.washCount,
        isDamaged: item.isDamaged,
        isStained: item.isStained,
      }));

    // Average wash count
    const avgWashCount = hotelItems.length > 0
      ? Math.round(hotelItems.reduce((sum, i) => sum + i.washCount, 0) / hotelItems.length)
      : 0;

    res.json({
      hotel: hotel ? {
        id: hotel.id,
        name: hotel.name,
        address: hotel.address,
        phone: hotel.phone,
      } : null,
      items: {
        total: hotelItems.length,
        atHotel: itemsByStatus['at_hotel'] || 0,
        atLaundry: (itemsByStatus['at_laundry'] || 0) + (itemsByStatus['processing'] || 0),
        inTransit: (itemsByStatus['in_transit'] || 0) + (itemsByStatus['packaged'] || 0) + (itemsByStatus['label_printed'] || 0),
        avgWashCount,
        damaged: hotelItems.filter(i => i.isDamaged).length,
        stained: hotelItems.filter(i => i.isStained).length,
      },
      deliveries: {
        today: todayDeliveries[0]?.count || 0,
        thisWeek: weekDeliveries[0]?.count || 0,
        thisMonth: monthDeliveries[0]?.count || 0,
        total: totalDeliveries[0]?.count || 0,
        pending: pendingDeliveries,
      },
      pickups: {
        today: todayPickups[0]?.count || 0,
        thisWeek: weekPickups[0]?.count || 0,
        thisMonth: monthPickups[0]?.count || 0,
        total: totalPickups[0]?.count || 0,
      },
      attentionItems,
    });
  } catch (error) {
    console.error('Get portal summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get delivery history with pagination and filters
portalRouter.get('/deliveries', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const tenantId = user.tenantId;

    if (!tenantId && user.role !== 'system_admin') {
      return res.status(403).json({ error: 'No tenant associated with this account' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const search = req.query.search as string;

    // Build conditions
    const conditions = [];
    if (tenantId) {
      conditions.push(eq(deliveries.tenantId, tenantId));
    }
    if (status) {
      conditions.push(eq(deliveries.status, status as any));
    }
    if (startDate) {
      conditions.push(gte(deliveries.createdAt, new Date(startDate)));
    }
    if (endDate) {
      conditions.push(lte(deliveries.createdAt, new Date(endDate)));
    }
    if (search) {
      conditions.push(sql`${deliveries.barcode} ILIKE ${'%' + search + '%'}`);
    }

    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const totalResult = await db.select({ count: count() }).from(deliveries).where(whereCondition);
    const total = totalResult[0]?.count || 0;

    // Get deliveries with items
    const deliveryList = await db.query.deliveries.findMany({
      where: whereCondition,
      orderBy: [desc(deliveries.createdAt)],
      limit,
      offset,
      with: {
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
      },
    });

    // Format response
    const formattedDeliveries = deliveryList.map(delivery => ({
      id: delivery.id,
      barcode: delivery.barcode,
      status: delivery.status,
      packageCount: delivery.packageCount,
      itemCount: delivery.deliveryItems?.length || 0,
      createdAt: delivery.createdAt,
      pickedUpAt: delivery.pickedUpAt,
      deliveredAt: delivery.deliveredAt,
      driver: delivery.driver ? {
        id: delivery.driver.id,
        name: `${delivery.driver.firstName} ${delivery.driver.lastName}`,
      } : null,
      items: delivery.deliveryItems?.map(di => ({
        id: di.item?.id,
        rfidTag: di.item?.rfidTag,
        itemType: di.item?.itemType?.name,
        status: di.item?.status,
      })) || [],
    }));

    res.json({
      data: formattedDeliveries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get portal deliveries error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get pickup history with pagination
portalRouter.get('/pickups', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const tenantId = user.tenantId;

    if (!tenantId && user.role !== 'system_admin') {
      return res.status(403).json({ error: 'No tenant associated with this account' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    // Build conditions
    const conditions = [];
    if (tenantId) {
      conditions.push(eq(pickups.tenantId, tenantId));
    }
    if (status) {
      conditions.push(eq(pickups.status, status as any));
    }
    if (startDate) {
      conditions.push(gte(pickups.createdAt, new Date(startDate)));
    }
    if (endDate) {
      conditions.push(lte(pickups.createdAt, new Date(endDate)));
    }

    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const totalResult = await db.select({ count: count() }).from(pickups).where(whereCondition);
    const total = totalResult[0]?.count || 0;

    // Get pickups with items
    const pickupList = await db.query.pickups.findMany({
      where: whereCondition,
      orderBy: [desc(pickups.createdAt)],
      limit,
      offset,
      with: {
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

    // Format response
    const formattedPickups = pickupList.map(pickup => ({
      id: pickup.id,
      bagCode: pickup.bagCode,
      sealNumber: pickup.sealNumber,
      status: pickup.status,
      itemCount: pickup.pickupItems?.length || 0,
      createdAt: pickup.createdAt,
      receivedAt: pickup.receivedDate,
      driver: pickup.driver ? {
        id: pickup.driver.id,
        name: `${pickup.driver.firstName} ${pickup.driver.lastName}`,
      } : null,
      items: pickup.pickupItems?.map(pi => ({
        id: pi.item?.id,
        rfidTag: pi.item?.rfidTag,
        itemType: pi.item?.itemType?.name,
      })) || [],
    }));

    res.json({
      data: formattedPickups,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get portal pickups error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get waybills (irsaliye) for the hotel
portalRouter.get('/waybills', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const tenantId = user.tenantId;

    if (!tenantId && user.role !== 'system_admin') {
      return res.status(403).json({ error: 'No tenant associated with this account' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const search = req.query.search as string;

    // Build conditions
    const conditions = [];
    if (tenantId) {
      conditions.push(eq(waybills.tenantId, tenantId));
    }
    if (startDate) {
      conditions.push(gte(waybills.createdAt, new Date(startDate)));
    }
    if (endDate) {
      conditions.push(lte(waybills.createdAt, new Date(endDate)));
    }
    if (search) {
      conditions.push(sql`${waybills.waybillNumber} ILIKE ${'%' + search + '%'}`);
    }

    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const totalResult = await db.select({ count: count() }).from(waybills).where(whereCondition);
    const total = totalResult[0]?.count || 0;

    // Get waybills
    const waybillList = await db.query.waybills.findMany({
      where: whereCondition,
      orderBy: [desc(waybills.createdAt)],
      limit,
      offset,
      with: {
        waybillDeliveries: {
          with: {
            delivery: true,
          },
        },
      },
    });

    // Format response
    const formattedWaybills = waybillList.map(waybill => ({
      id: waybill.id,
      waybillNumber: waybill.waybillNumber,
      status: waybill.status,
      packageCount: waybill.packageCount,
      bagCount: waybill.bagCount,
      totalItems: waybill.totalItems,
      itemSummary: waybill.itemSummary ? JSON.parse(waybill.itemSummary) : null,
      etaSynced: false, // Not in schema yet
      etaRefNo: null,
      createdAt: waybill.createdAt,
      printedAt: waybill.printedAt,
      deliveredAt: waybill.deliveredAt,
      deliveryCount: waybill.waybillDeliveries?.length || 0,
    }));

    res.json({
      data: formattedWaybills,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get portal waybills error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single waybill details for PDF generation
portalRouter.get('/waybills/:id', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const tenantId = user.tenantId;
    const { id } = req.params;

    const waybill = await db.query.waybills.findFirst({
      where: eq(waybills.id, id),
      with: {
        tenant: true,
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
    });

    if (!waybill) {
      return res.status(404).json({ error: 'Waybill not found' });
    }

    // Check tenant access
    if (tenantId && waybill.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(waybill);
  } catch (error) {
    console.error('Get portal waybill error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get real-time item status counts
portalRouter.get('/items/status', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const tenantId = user.tenantId;

    if (!tenantId && user.role !== 'system_admin') {
      return res.status(403).json({ error: 'No tenant associated with this account' });
    }

    const tenantCondition = tenantId ? eq(items.tenantId, tenantId) : undefined;

    // Get items count by status
    const statusCounts = await db
      .select({
        status: items.status,
        count: count(),
      })
      .from(items)
      .where(tenantCondition)
      .groupBy(items.status);

    const itemsByStatus = statusCounts.reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {} as Record<string, number>);

    // Get items by type
    const typeCounts = await db.query.items.findMany({
      where: tenantCondition,
      with: {
        itemType: true,
      },
    });

    const itemsByType = typeCounts.reduce((acc, item) => {
      const typeName = item.itemType?.name || 'Unknown';
      if (!acc[typeName]) {
        acc[typeName] = { total: 0, atHotel: 0, atLaundry: 0, inTransit: 0 };
      }
      acc[typeName].total++;
      if (item.status === 'at_hotel') acc[typeName].atHotel++;
      if (['at_laundry', 'processing', 'ready_for_delivery'].includes(item.status)) acc[typeName].atLaundry++;
      if (['in_transit', 'label_printed', 'packaged'].includes(item.status)) acc[typeName].inTransit++;
      return acc;
    }, {} as Record<string, { total: number; atHotel: number; atLaundry: number; inTransit: number }>);

    res.json({
      total: typeCounts.length,
      byStatus: {
        atHotel: itemsByStatus['at_hotel'] || 0,
        atLaundry: (itemsByStatus['at_laundry'] || 0) + (itemsByStatus['processing'] || 0),
        readyForDelivery: (itemsByStatus['ready_for_delivery'] || 0) + (itemsByStatus['label_printed'] || 0),
        packaged: itemsByStatus['packaged'] || 0,
        inTransit: itemsByStatus['in_transit'] || 0,
        delivered: itemsByStatus['delivered'] || 0,
      },
      byType: itemsByType,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get portal item status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get recent activity timeline
portalRouter.get('/activity', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const tenantId = user.tenantId;

    if (!tenantId && user.role !== 'system_admin') {
      return res.status(403).json({ error: 'No tenant associated with this account' });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    // Get recent pickups
    const recentPickups = await db.query.pickups.findMany({
      where: eq(pickups.tenantId, tenantId!),
      orderBy: [desc(pickups.createdAt)],
      limit: 10,
      with: {
        driver: true,
        pickupItems: true,
      },
    });

    // Get recent deliveries
    const recentDeliveries = await db.query.deliveries.findMany({
      where: eq(deliveries.tenantId, tenantId!),
      orderBy: [desc(deliveries.createdAt)],
      limit: 10,
      with: {
        driver: true,
        deliveryItems: true,
      },
    });

    // Combine and sort by date
    const activities = [
      ...recentPickups.map(p => ({
        type: 'pickup' as const,
        id: p.id,
        date: p.createdAt,
        title: `Kirli camasir toplandi`,
        description: `${p.pickupItems?.length || 0} urun - Cuval: ${p.bagCode || 'N/A'}`,
        status: p.status,
        driver: p.driver ? `${p.driver.firstName} ${p.driver.lastName}` : null,
      })),
      ...recentDeliveries.map(d => ({
        type: 'delivery' as const,
        id: d.id,
        date: d.createdAt,
        title: d.status === 'delivered' ? 'Temiz camasir teslim edildi' : 'Teslimat olusturuldu',
        description: `${d.deliveryItems?.length || 0} urun - Barkod: ${d.barcode}`,
        status: d.status,
        driver: d.driver ? `${d.driver.firstName} ${d.driver.lastName}` : null,
      })),
    ]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, limit);

    res.json(activities);
  } catch (error) {
    console.error('Get portal activity error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
