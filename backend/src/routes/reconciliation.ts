import { Router } from 'express';
import { db } from '../db';
import { pickups, pickupItems, deliveries, deliveryItems, items, tenants, itemTypes } from '../db/schema';
import { eq, and, gte, lte, sql, desc, inArray, ne } from 'drizzle-orm';
import { requireAuth, AuthRequest } from '../middleware/auth';

export const reconciliationRouter = Router();
reconciliationRouter.use(requireAuth);

// Get reconciliation data - compare pickups vs deliveries to find missing items
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

    // Build tenant filter
    let tenantFilter = tenantId ? tenantId as string : undefined;
    if (user.role === 'hotel_owner' && user.tenantId) {
      tenantFilter = user.tenantId;
    }

    // Get all pickups in date range with items
    const pickupConditions = [
      gte(pickups.pickupDate, start),
      lte(pickups.pickupDate, end)
    ];
    if (tenantFilter) {
      pickupConditions.push(eq(pickups.tenantId, tenantFilter));
    }

    const allPickups = await db.query.pickups.findMany({
      where: and(...pickupConditions),
      orderBy: [desc(pickups.pickupDate)],
      with: {
        tenant: true,
        driver: true,
        pickupItems: {
          with: {
            item: {
              with: {
                itemType: true,
                tenant: true,
              },
            },
          },
        },
      },
    });

    // Get all deliveries in date range with items
    const deliveryConditions = [
      gte(deliveries.createdAt, start),
      lte(deliveries.createdAt, end)
    ];
    if (tenantFilter) {
      deliveryConditions.push(eq(deliveries.tenantId, tenantFilter));
    }

    const allDeliveries = await db.query.deliveries.findMany({
      where: and(...deliveryConditions),
      orderBy: [desc(deliveries.createdAt)],
      with: {
        tenant: true,
        driver: true,
        deliveryItems: {
          with: {
            item: {
              with: {
                itemType: true,
                tenant: true,
              },
            },
          },
        },
      },
    });

    // Collect all picked up item IDs
    const pickedUpItemIds = new Set<string>();
    const pickedUpItems: any[] = [];
    for (const pickup of allPickups) {
      for (const pi of pickup.pickupItems || []) {
        if (pi.item) {
          pickedUpItemIds.add(pi.item.id);
          pickedUpItems.push({
            ...pi.item,
            pickupDate: pickup.pickupDate,
            pickupId: pickup.id,
            bagCode: pickup.bagCode,
          });
        }
      }
    }

    // Collect all delivered item IDs
    const deliveredItemIds = new Set<string>();
    const deliveredItems: any[] = [];
    for (const delivery of allDeliveries) {
      for (const di of delivery.deliveryItems || []) {
        if (di.item) {
          deliveredItemIds.add(di.item.id);
          deliveredItems.push({
            ...di.item,
            deliveryDate: delivery.deliveredAt || delivery.createdAt,
            deliveryId: delivery.id,
            deliveryBarcode: delivery.barcode,
            deliveryStatus: delivery.status,
          });
        }
      }
    }

    // Find items that were picked up but NOT delivered yet
    const pendingItems = pickedUpItems.filter(item => !deliveredItemIds.has(item.id));

    // Find items that were delivered but were NOT in pickups (unusual - maybe older pickups)
    const unexpectedDeliveries = deliveredItems.filter(item => !pickedUpItemIds.has(item.id));

    // Get current status of pending items from database
    const pendingItemIds = pendingItems.map(i => i.id);
    let currentStatusItems: any[] = [];
    if (pendingItemIds.length > 0) {
      currentStatusItems = await db.query.items.findMany({
        where: inArray(items.id, pendingItemIds),
        with: {
          itemType: true,
          tenant: true,
        },
      });
    }

    // Categorize pending items by current status
    const atLaundry: any[] = [];
    const inProcessing: any[] = [];
    const readyForDelivery: any[] = [];
    const inTransit: any[] = [];
    const missing: any[] = []; // Items that should be somewhere but status is unexpected

    for (const pendingItem of pendingItems) {
      const currentItem = currentStatusItems.find(i => i.id === pendingItem.id);
      if (!currentItem) {
        missing.push(pendingItem);
        continue;
      }

      const itemWithStatus = {
        ...pendingItem,
        currentStatus: currentItem.status,
        daysSincePickup: Math.floor((Date.now() - new Date(pendingItem.pickupDate).getTime()) / (1000 * 60 * 60 * 24)),
      };

      switch (currentItem.status) {
        case 'at_laundry':
          atLaundry.push(itemWithStatus);
          break;
        case 'processing':
          inProcessing.push(itemWithStatus);
          break;
        case 'ready_for_delivery':
        case 'label_printed':
        case 'packaged':
          readyForDelivery.push(itemWithStatus);
          break;
        case 'in_transit':
          inTransit.push(itemWithStatus);
          break;
        case 'at_hotel':
        case 'delivered':
          // Item is back at hotel but not through a delivery in our date range
          // Could be from an older delivery
          break;
        default:
          missing.push(itemWithStatus);
      }
    }

    // Group by hotel
    const groupByHotel = (items: any[]) => {
      const grouped: Record<string, { hotel: any; items: any[]; byType: Record<string, number> }> = {};
      for (const item of items) {
        const hotelId = item.tenantId || item.tenant?.id;
        const hotelName = item.tenant?.name || 'Bilinmeyen Otel';
        if (!grouped[hotelId]) {
          grouped[hotelId] = { hotel: item.tenant || { id: hotelId, name: hotelName }, items: [], byType: {} };
        }
        grouped[hotelId].items.push(item);
        const typeName = item.itemType?.name || 'Bilinmeyen';
        grouped[hotelId].byType[typeName] = (grouped[hotelId].byType[typeName] || 0) + 1;
      }
      return Object.values(grouped);
    };

    // Group by item type for summary
    const groupByType = (items: any[]) => {
      const grouped: Record<string, number> = {};
      for (const item of items) {
        const typeName = item.itemType?.name || 'Bilinmeyen';
        grouped[typeName] = (grouped[typeName] || 0) + 1;
      }
      return grouped;
    };

    // Calculate summary
    const summary = {
      totalPickedUp: pickedUpItems.length,
      totalDelivered: deliveredItems.length,
      pendingReturn: pendingItems.length,
      atLaundry: atLaundry.length,
      inProcessing: inProcessing.length,
      readyForDelivery: readyForDelivery.length,
      inTransit: inTransit.length,
      potentiallyMissing: missing.length,
    };

    res.json({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      summary,
      // Items by status
      atLaundry: {
        count: atLaundry.length,
        byType: groupByType(atLaundry),
        byHotel: groupByHotel(atLaundry),
        items: atLaundry.slice(0, 100), // Limit for performance
      },
      inProcessing: {
        count: inProcessing.length,
        byType: groupByType(inProcessing),
        byHotel: groupByHotel(inProcessing),
        items: inProcessing.slice(0, 100),
      },
      readyForDelivery: {
        count: readyForDelivery.length,
        byType: groupByType(readyForDelivery),
        byHotel: groupByHotel(readyForDelivery),
        items: readyForDelivery.slice(0, 100),
      },
      inTransit: {
        count: inTransit.length,
        byType: groupByType(inTransit),
        byHotel: groupByHotel(inTransit),
        items: inTransit.slice(0, 100),
      },
      missing: {
        count: missing.length,
        byType: groupByType(missing),
        byHotel: groupByHotel(missing),
        items: missing.slice(0, 100),
      },
      // All picked up items with their current status for detailed view
      allPickedUp: {
        count: pickedUpItems.length,
        byType: groupByType(pickedUpItems),
      },
      allDelivered: {
        count: deliveredItems.length,
        byType: groupByType(deliveredItems),
      },
    });
  } catch (error) {
    console.error('Get reconciliation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get items that have been at laundry too long (potential issues)
reconciliationRouter.get('/overdue', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const { tenantId, daysThreshold = '3' } = req.query;
    const threshold = parseInt(daysThreshold as string) || 3;

    // Build tenant filter
    let tenantFilter = tenantId ? tenantId as string : undefined;
    if (user.role === 'hotel_owner' && user.tenantId) {
      tenantFilter = user.tenantId;
    }

    // Find items that are at_laundry or processing for too long
    const conditions = [
      inArray(items.status, ['at_laundry', 'processing', 'ready_for_delivery', 'label_printed', 'packaged']),
    ];
    if (tenantFilter) {
      conditions.push(eq(items.tenantId, tenantFilter));
    }

    const overdueItems = await db.query.items.findMany({
      where: and(...conditions),
      with: {
        itemType: true,
        tenant: true,
      },
    });

    // Filter by days at laundry (based on updatedAt or use pickup date)
    const now = Date.now();
    const thresholdMs = threshold * 24 * 60 * 60 * 1000;

    const filteredItems = overdueItems.filter(item => {
      const lastUpdate = new Date(item.updatedAt).getTime();
      return (now - lastUpdate) > thresholdMs;
    }).map(item => ({
      ...item,
      daysAtLaundry: Math.floor((now - new Date(item.updatedAt).getTime()) / (1000 * 60 * 60 * 24)),
    }));

    // Group by hotel
    const byHotel: Record<string, any[]> = {};
    for (const item of filteredItems) {
      const hotelId = item.tenantId;
      if (!byHotel[hotelId]) {
        byHotel[hotelId] = [];
      }
      byHotel[hotelId].push(item);
    }

    res.json({
      threshold,
      totalOverdue: filteredItems.length,
      items: filteredItems,
      byHotel: Object.entries(byHotel).map(([hotelId, items]) => ({
        hotel: items[0]?.tenant,
        count: items.length,
        items,
      })),
    });
  } catch (error) {
    console.error('Get overdue items error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
