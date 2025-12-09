import { Router } from 'express';
import { db } from '../db';
import { items, pickups, deliveries, alerts, tenants } from '../db/schema';
import { eq, and, desc, sql, count, inArray } from 'drizzle-orm';
import { requireAuth, AuthRequest } from '../middleware/auth';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

// Get dashboard statistics with optimized queries
dashboardRouter.get('/stats', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;

    // Build tenant condition
    const tenantCondition = user.role !== 'system_admin' && user.tenantId
      ? eq(items.tenantId, user.tenantId)
      : undefined;

    // Get items count by status using SQL aggregation (more efficient)
    const itemsByStatusResult = await db
      .select({
        status: items.status,
        count: count(),
      })
      .from(items)
      .where(tenantCondition)
      .groupBy(items.status);

    const itemsByStatus = itemsByStatusResult.reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {} as Record<string, number>);

    // Calculate total items
    const totalItems = Object.values(itemsByStatus).reduce((sum, val) => sum + val, 0);

    // Get items needing attention (damaged, stained, high wash count)
    const attentionItems = await db.query.items.findMany({
      where: and(
        tenantCondition,
        sql`(${items.isDamaged} = true OR ${items.isStained} = true OR ${items.washCount} > 50)`
      ),
      limit: 10,
      with: {
        itemType: true,
        tenant: true,
      },
    });

    // Get recent pickups
    const pickupCondition = user.role !== 'system_admin' && user.tenantId
      ? eq(pickups.tenantId, user.tenantId)
      : undefined;

    const recentPickups = await db.query.pickups.findMany({
      where: pickupCondition,
      limit: 5,
      orderBy: [desc(pickups.createdAt)],
      with: {
        tenant: true,
        driver: true,
      },
    });

    // Get recent deliveries
    const deliveryCondition = user.role !== 'system_admin' && user.tenantId
      ? eq(deliveries.tenantId, user.tenantId)
      : undefined;

    const recentDeliveries = await db.query.deliveries.findMany({
      where: deliveryCondition,
      limit: 5,
      orderBy: [desc(deliveries.createdAt)],
      with: {
        tenant: true,
        driver: true,
      },
    });

    // Get unread alerts count
    const alertConditions = [eq(alerts.isRead, false)];
    if (user.role !== 'system_admin' && user.tenantId) {
      alertConditions.push(eq(alerts.tenantId, user.tenantId));
    }

    const unreadAlertsResult = await db
      .select({ count: count() })
      .from(alerts)
      .where(and(...alertConditions));

    const unreadAlerts = unreadAlertsResult[0]?.count || 0;

    // Get workflow summary
    const workflowSummary = {
      atHotel: itemsByStatus['at_hotel'] || 0,
      atLaundry: itemsByStatus['at_laundry'] || 0,
      processing: itemsByStatus['processing'] || 0,
      readyForDelivery: itemsByStatus['ready_for_delivery'] || 0,
      labelPrinted: itemsByStatus['label_printed'] || 0,
      packaged: itemsByStatus['packaged'] || 0,
      inTransit: itemsByStatus['in_transit'] || 0,
      delivered: itemsByStatus['delivered'] || 0,
    };

    // Get today's activity
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    const todayPickups = await db
      .select({ count: count() })
      .from(pickups)
      .where(and(
        pickupCondition,
        sql`${pickups.createdAt} >= ${todayISO}::timestamp`
      ));

    const todayDeliveries = await db
      .select({ count: count() })
      .from(deliveries)
      .where(and(
        deliveryCondition,
        sql`${deliveries.deliveredAt} >= ${todayISO}::timestamp`
      ));

    res.json({
      itemsByStatus,
      totalItems,
      workflowSummary,
      attentionItems,
      recentPickups,
      recentDeliveries,
      unreadAlerts,
      todayActivity: {
        pickups: todayPickups[0]?.count || 0,
        deliveries: todayDeliveries[0]?.count || 0,
      },
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get workflow overview
dashboardRouter.get('/workflow', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;

    const tenantCondition = user.role !== 'system_admin' && user.tenantId
      ? eq(items.tenantId, user.tenantId)
      : undefined;

    // Get counts for each workflow step
    const statusCounts = await db
      .select({
        status: items.status,
        count: count(),
      })
      .from(items)
      .where(tenantCondition)
      .groupBy(items.status);

    const workflow = [
      { step: 1, name: 'At Hotel', status: 'at_hotel', count: 0 },
      { step: 2, name: 'At Laundry', status: 'at_laundry', count: 0 },
      { step: 3, name: 'Processing', status: 'processing', count: 0 },
      { step: 4, name: 'Ready for Delivery', status: 'ready_for_delivery', count: 0 },
      { step: 5, name: 'Label Printed', status: 'label_printed', count: 0 },
      { step: 6, name: 'Packaged', status: 'packaged', count: 0 },
      { step: 7, name: 'In Transit', status: 'in_transit', count: 0 },
      { step: 8, name: 'Delivered', status: 'delivered', count: 0 },
    ];

    // Populate counts
    for (const row of statusCounts) {
      const step = workflow.find(w => w.status === row.status);
      if (step) {
        step.count = row.count;
      }
    }

    res.json(workflow);
  } catch (error) {
    console.error('Get workflow error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get item type distribution
dashboardRouter.get('/item-types', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;

    const tenantCondition = user.role !== 'system_admin' && user.tenantId
      ? eq(items.tenantId, user.tenantId)
      : undefined;

    const itemTypeDistribution = await db.query.items.findMany({
      where: tenantCondition,
      with: {
        itemType: true,
      },
    });

    // Group by item type
    const distribution = itemTypeDistribution.reduce((acc, item) => {
      const typeName = item.itemType?.name || 'Unknown';
      acc[typeName] = (acc[typeName] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    res.json(distribution);
  } catch (error) {
    console.error('Get item type distribution error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get hotel-specific stats (for hotel owners)
dashboardRouter.get('/hotel-stats', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;

    // This endpoint is primarily for hotel owners but works for admins too
    const tenantCondition = user.role !== 'system_admin' && user.tenantId
      ? eq(items.tenantId, user.tenantId)
      : undefined;

    // Get all items for the hotel
    const hotelItems = await db.query.items.findMany({
      where: tenantCondition,
      with: {
        itemType: true,
      },
    });

    // Calculate item age (days since created)
    const now = new Date();
    const itemsWithAge = hotelItems.map(item => {
      const createdAt = new Date(item.createdAt);
      const ageInDays = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
      return { ...item, ageInDays };
    });

    // Item age distribution
    const ageDistribution = {
      new: itemsWithAge.filter(i => i.ageInDays <= 30).length,        // 0-30 days
      moderate: itemsWithAge.filter(i => i.ageInDays > 30 && i.ageInDays <= 90).length,  // 31-90 days
      old: itemsWithAge.filter(i => i.ageInDays > 90 && i.ageInDays <= 180).length,      // 91-180 days
      veryOld: itemsWithAge.filter(i => i.ageInDays > 180).length,    // 180+ days
    };

    // Wash count distribution
    const washCountDistribution = {
      low: hotelItems.filter(i => i.washCount <= 10).length,           // 0-10 washes
      moderate: hotelItems.filter(i => i.washCount > 10 && i.washCount <= 30).length,   // 11-30 washes
      high: hotelItems.filter(i => i.washCount > 30 && i.washCount <= 50).length,       // 31-50 washes
      veryHigh: hotelItems.filter(i => i.washCount > 50).length,       // 50+ washes (needs replacement)
    };

    // Average wash count
    const avgWashCount = hotelItems.length > 0
      ? Math.round(hotelItems.reduce((sum, i) => sum + i.washCount, 0) / hotelItems.length)
      : 0;

    // Items by status
    const itemsByStatus = hotelItems.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Items by type with counts
    const itemsByType = hotelItems.reduce((acc, item) => {
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

    // Discrepancies / Issues
    const discrepancies = {
      damaged: hotelItems.filter(i => i.isDamaged).length,
      stained: hotelItems.filter(i => i.isStained).length,
      highWashCount: hotelItems.filter(i => i.washCount > 50).length,
      missing: itemsByStatus['at_laundry'] || 0 + itemsByStatus['processing'] || 0,  // Items currently away
    };

    // Get items needing attention (detailed)
    const attentionItems = hotelItems
      .filter(i => i.isDamaged || i.isStained || i.washCount > 50)
      .slice(0, 20)
      .map(item => ({
        id: item.id,
        rfidTag: item.rfidTag,
        itemType: item.itemType?.name,
        status: item.status,
        washCount: item.washCount,
        isDamaged: item.isDamaged,
        isStained: item.isStained,
        ageInDays: itemsWithAge.find(i => i.id === item.id)?.ageInDays || 0,
      }));

    // Pickup/Delivery history counts
    const pickupCondition = user.role !== 'system_admin' && user.tenantId
      ? eq(pickups.tenantId, user.tenantId)
      : undefined;

    const deliveryCondition = user.role !== 'system_admin' && user.tenantId
      ? eq(deliveries.tenantId, user.tenantId)
      : undefined;

    const totalPickups = await db
      .select({ count: count() })
      .from(pickups)
      .where(pickupCondition);

    const totalDeliveries = await db
      .select({ count: count() })
      .from(deliveries)
      .where(deliveryCondition);

    const completedDeliveries = await db
      .select({ count: count() })
      .from(deliveries)
      .where(and(
        deliveryCondition,
        eq(deliveries.status, 'delivered')
      ));

    res.json({
      totalItems: hotelItems.length,
      itemsByStatus,
      itemsByType,
      ageDistribution,
      washCountDistribution,
      avgWashCount,
      discrepancies,
      attentionItems,
      pickupDeliveryStats: {
        totalPickups: totalPickups[0]?.count || 0,
        totalDeliveries: totalDeliveries[0]?.count || 0,
        completedDeliveries: completedDeliveries[0]?.count || 0,
        itemsAtLaundry: (itemsByStatus['at_laundry'] || 0) + (itemsByStatus['processing'] || 0),
        itemsInTransit: (itemsByStatus['in_transit'] || 0) + (itemsByStatus['label_printed'] || 0) + (itemsByStatus['packaged'] || 0),
      },
    });
  } catch (error) {
    console.error('Get hotel stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get hotel status board - visual grid showing status of each hotel
// Status logic:
// - waiting: No active items in pipeline (gray)
// - collected: Driver collected dirty items (red)
// - packaged: Items are packaged and ready for delivery (yellow)
// - in_transit: Items are being delivered (green)
// - delivered: Items delivered to hotel (blue)
dashboardRouter.get('/hotel-status-board', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;

    // Only admins can see all hotels
    if (user.role !== 'system_admin' && user.role !== 'laundry_manager') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get all active hotels
    const allTenants = await db.query.tenants.findMany({
      where: eq(tenants.isActive, true),
      orderBy: [tenants.name],
    });

    // Get item counts by status for each hotel
    const hotelStatuses = await Promise.all(
      allTenants.map(async (tenant) => {
        // Get item counts by status
        const itemCounts = await db
          .select({
            status: items.status,
            count: count(),
          })
          .from(items)
          .where(eq(items.tenantId, tenant.id))
          .groupBy(items.status);

        const statusMap = itemCounts.reduce((acc, row) => {
          acc[row.status] = row.count;
          return acc;
        }, {} as Record<string, number>);

        // Calculate counts for each stage
        const pendingItems = statusMap['at_hotel'] || 0;
        const collectedItems = statusMap['at_laundry'] || 0;
        const processingItems = statusMap['processing'] || 0;
        const readyItems = (statusMap['ready_for_delivery'] || 0) + (statusMap['label_printed'] || 0);
        const packagedItems = statusMap['packaged'] || 0;
        const inTransitItems = statusMap['in_transit'] || 0;
        const deliveredItems = statusMap['delivered'] || 0;

        // Determine overall status based on priority
        // Priority: in_transit > packaged > collected > delivered > waiting
        let status: 'waiting' | 'collected' | 'packaged' | 'in_transit' | 'delivered' = 'waiting';

        if (inTransitItems > 0) {
          status = 'in_transit';
        } else if (packagedItems > 0) {
          status = 'packaged';
        } else if (collectedItems > 0 || processingItems > 0 || readyItems > 0) {
          status = 'collected';
        } else if (deliveredItems > 0 && pendingItems === 0) {
          status = 'delivered';
        }

        // Get last item update time
        const lastItem = await db.query.items.findFirst({
          where: eq(items.tenantId, tenant.id),
          orderBy: [desc(items.updatedAt)],
        });

        // Generate short name (first letters of words, max 3 chars)
        const words = tenant.name.split(' ').filter(w => w.length > 0);
        let shortName = '';
        if (words.length >= 2) {
          shortName = words.map(w => w[0]).join('').substring(0, 3).toUpperCase();
        } else {
          shortName = tenant.name.substring(0, 3).toUpperCase();
        }

        return {
          id: tenant.id,
          name: tenant.name,
          shortName,
          status,
          pendingItems,
          collectedItems: collectedItems + processingItems + readyItems,
          packagedItems,
          inTransitItems,
          deliveredItems,
          lastUpdate: lastItem?.updatedAt || null,
        };
      })
    );

    res.json(hotelStatuses);
  } catch (error) {
    console.error('Get hotel status board error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
