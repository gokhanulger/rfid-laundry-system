import { Router } from 'express';
import { db } from '../db';
import { pickups, pickupItems, deliveries, deliveryItems, items, tenants, itemTypes } from '../db/schema';
import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';
import { requireAuth, AuthRequest } from '../middleware/auth';

export const reconciliationRouter = Router();
reconciliationRouter.use(requireAuth);

// Get reconciliation data - pickups and deliveries grouped by date
reconciliationRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const { startDate, endDate, tenantId } = req.query;

    // Default to last 30 days if no date range specified
    const end = endDate ? new Date(endDate as string) : new Date();
    const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Set end date to end of day
    end.setHours(23, 59, 59, 999);
    start.setHours(0, 0, 0, 0);

    // Build tenant filter conditions
    let tenantFilter = tenantId ? eq(pickups.tenantId, tenantId as string) : undefined;

    // For hotel owners, only show their own data
    if (user.role === 'hotel_owner' && user.tenantId) {
      tenantFilter = eq(pickups.tenantId, user.tenantId);
    }

    // Get all pickups in date range with items
    const allPickups = await db.query.pickups.findMany({
      where: and(
        tenantFilter,
        gte(pickups.pickupDate, start),
        lte(pickups.pickupDate, end)
      ),
      orderBy: [desc(pickups.pickupDate)],
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

    // Get all deliveries in date range with items
    let deliveryTenantFilter = tenantId ? eq(deliveries.tenantId, tenantId as string) : undefined;
    if (user.role === 'hotel_owner' && user.tenantId) {
      deliveryTenantFilter = eq(deliveries.tenantId, user.tenantId);
    }

    const allDeliveries = await db.query.deliveries.findMany({
      where: and(
        deliveryTenantFilter,
        gte(deliveries.createdAt, start),
        lte(deliveries.createdAt, end)
      ),
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

    // Group by date
    const dateMap = new Map<string, {
      date: string;
      pickups: typeof allPickups;
      deliveries: typeof allDeliveries;
      pickupItemCount: number;
      deliveryItemCount: number;
      pickupsByType: Record<string, number>;
      deliveriesByType: Record<string, number>;
    }>();

    // Process pickups
    for (const pickup of allPickups) {
      const dateKey = new Date(pickup.pickupDate).toISOString().split('T')[0];

      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, {
          date: dateKey,
          pickups: [],
          deliveries: [],
          pickupItemCount: 0,
          deliveryItemCount: 0,
          pickupsByType: {},
          deliveriesByType: {},
        });
      }

      const dayData = dateMap.get(dateKey)!;
      dayData.pickups.push(pickup);
      dayData.pickupItemCount += pickup.pickupItems?.length || 0;

      // Count by item type
      for (const pi of pickup.pickupItems || []) {
        const typeName = pi.item?.itemType?.name || 'Bilinmeyen';
        dayData.pickupsByType[typeName] = (dayData.pickupsByType[typeName] || 0) + 1;
      }
    }

    // Process deliveries
    for (const delivery of allDeliveries) {
      const dateKey = new Date(delivery.createdAt).toISOString().split('T')[0];

      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, {
          date: dateKey,
          pickups: [],
          deliveries: [],
          pickupItemCount: 0,
          deliveryItemCount: 0,
          pickupsByType: {},
          deliveriesByType: {},
        });
      }

      const dayData = dateMap.get(dateKey)!;
      dayData.deliveries.push(delivery);
      dayData.deliveryItemCount += delivery.deliveryItems?.length || 0;

      // Count by item type
      for (const di of delivery.deliveryItems || []) {
        const typeName = di.item?.itemType?.name || 'Bilinmeyen';
        dayData.deliveriesByType[typeName] = (dayData.deliveriesByType[typeName] || 0) + 1;
      }
    }

    // Convert to array and sort by date descending
    const reconciliationData = Array.from(dateMap.values())
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Calculate totals
    const totals = {
      totalPickups: allPickups.length,
      totalDeliveries: allDeliveries.length,
      totalPickupItems: allPickups.reduce((sum, p) => sum + (p.pickupItems?.length || 0), 0),
      totalDeliveryItems: allDeliveries.reduce((sum, d) => sum + (d.deliveryItems?.length || 0), 0),
      pickupsByType: {} as Record<string, number>,
      deliveriesByType: {} as Record<string, number>,
    };

    // Aggregate totals by type
    for (const day of reconciliationData) {
      for (const [type, count] of Object.entries(day.pickupsByType)) {
        totals.pickupsByType[type] = (totals.pickupsByType[type] || 0) + count;
      }
      for (const [type, count] of Object.entries(day.deliveriesByType)) {
        totals.deliveriesByType[type] = (totals.deliveriesByType[type] || 0) + count;
      }
    }

    res.json({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      totals,
      byDate: reconciliationData,
    });
  } catch (error) {
    console.error('Get reconciliation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get detailed breakdown for a specific date
reconciliationRouter.get('/date/:date', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const { date } = req.params;
    const { tenantId } = req.query;

    const targetDate = new Date(date);
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Build tenant filter
    let tenantFilter = tenantId ? eq(pickups.tenantId, tenantId as string) : undefined;
    if (user.role === 'hotel_owner' && user.tenantId) {
      tenantFilter = eq(pickups.tenantId, user.tenantId);
    }

    // Get pickups for the date
    const dayPickups = await db.query.pickups.findMany({
      where: and(
        tenantFilter,
        gte(pickups.pickupDate, startOfDay),
        lte(pickups.pickupDate, endOfDay)
      ),
      orderBy: [desc(pickups.pickupDate)],
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

    // Get deliveries for the date
    let deliveryTenantFilter = tenantId ? eq(deliveries.tenantId, tenantId as string) : undefined;
    if (user.role === 'hotel_owner' && user.tenantId) {
      deliveryTenantFilter = eq(deliveries.tenantId, user.tenantId);
    }

    const dayDeliveries = await db.query.deliveries.findMany({
      where: and(
        deliveryTenantFilter,
        gte(deliveries.createdAt, startOfDay),
        lte(deliveries.createdAt, endOfDay)
      ),
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

    res.json({
      date,
      pickups: dayPickups,
      deliveries: dayDeliveries,
      summary: {
        pickupCount: dayPickups.length,
        deliveryCount: dayDeliveries.length,
        pickupItemCount: dayPickups.reduce((sum, p) => sum + (p.pickupItems?.length || 0), 0),
        deliveryItemCount: dayDeliveries.reduce((sum, d) => sum + (d.deliveryItems?.length || 0), 0),
      },
    });
  } catch (error) {
    console.error('Get reconciliation date error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
