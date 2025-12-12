import { Router } from 'express';
import { db } from '../db';
import { deliveries, deliveryItems, deliveryPackages, items, tenants, users } from '../db/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { requireAuth, AuthRequest, requireRole } from '../middleware/auth';
import { z } from 'zod';
import { sendDeliveryNotification } from '../services/email';

export const deliveriesRouter = Router();
deliveriesRouter.use(requireAuth);

// Calculate distance between two GPS coordinates using Haversine formula (in meters)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// Validation schemas
const createDeliverySchema = z.object({
  tenantId: z.string().uuid('Invalid tenant ID'),
  itemIds: z.array(z.string().uuid()), // Allow empty array for manual deliveries
  packageCount: z.number().int().min(1, 'Package count must be at least 1').default(1),
  notes: z.string().optional(),
});

// Create delivery
deliveriesRouter.post('/', requireRole('operator', 'laundry_manager', 'system_admin', 'ironer', 'packager'), async (req: AuthRequest, res) => {
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

    // Verify all items exist and are ready for delivery (skip if no items - manual delivery)
    if (itemIds.length > 0) {
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
    }

    // Generate unique barcode - 9 digit sequential number starting from 1
    const lastDelivery = await db.query.deliveries.findFirst({
      orderBy: desc(deliveries.createdAt),
      columns: { barcode: true }
    });

    let nextNumber = 1;
    if (lastDelivery?.barcode) {
      // Try to parse the barcode as a number
      const num = parseInt(lastDelivery.barcode, 10);
      if (!isNaN(num)) {
        nextNumber = num + 1;
      }
    }
    const barcode = nextNumber.toString().padStart(9, '0');

    // Create delivery
    const [newDelivery] = await db.insert(deliveries).values({
      tenantId,
      barcode,
      packageCount,
      notes,
    }).returning();

    // Associate items with delivery (skip if no items - manual delivery)
    if (itemIds.length > 0) {
      await db.insert(deliveryItems).values(
        itemIds.map((itemId: string) => ({
          deliveryId: newDelivery.id,
          itemId,
        }))
      );
    }

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
    const driverId = req.query.driverId as string | undefined;

    // Build where conditions
    const conditions = [];
    if (user.role !== 'system_admin' && user.tenantId) {
      conditions.push(eq(deliveries.tenantId, user.tenantId));
    }
    if (status) {
      conditions.push(eq(deliveries.status, status as any));
    }
    if (driverId) {
      conditions.push(eq(deliveries.driverId, driverId));
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
deliveriesRouter.post('/:id/print-label', requireRole('operator', 'laundry_manager', 'system_admin', 'ironer', 'packager'), async (req: AuthRequest, res) => {
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

// Scan package barcode (driver claims package for delivery)
deliveriesRouter.post('/packages/:barcode/scan', requireRole('driver', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    const { barcode } = req.params;

    // Find the package by barcode
    const pkg = await db.query.deliveryPackages.findFirst({
      where: eq(deliveryPackages.packageBarcode, barcode),
      with: {
        delivery: {
          with: {
            tenant: true,
          },
        },
      },
    });

    if (!pkg) {
      return res.status(404).json({ error: 'Package not found' });
    }

    // Check if package is in a delivery that's ready for pickup
    if (pkg.delivery.status !== 'packaged') {
      return res.status(400).json({ error: 'Package is not ready for pickup. Current status: ' + pkg.delivery.status });
    }

    // Update package with scanned info
    const [updatedPackage] = await db.update(deliveryPackages)
      .set({
        status: 'scanned',
        scannedAt: new Date(),
        scannedBy: req.user!.id,
      })
      .where(eq(deliveryPackages.id, pkg.id))
      .returning();

    // Check if all packages for this delivery have been scanned
    const allPackages = await db.query.deliveryPackages.findMany({
      where: eq(deliveryPackages.deliveryId, pkg.deliveryId),
    });

    const allScanned = allPackages.every(p => p.status === 'scanned' || p.id === updatedPackage.id);

    // If all packages scanned, update delivery status to picked_up
    if (allScanned) {
      await db.update(deliveries)
        .set({
          status: 'picked_up',
          driverId: req.user!.id,
          pickedUpAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(deliveries.id, pkg.deliveryId));

      // Update items status
      const deliveryItemsList = await db.query.deliveryItems.findMany({
        where: eq(deliveryItems.deliveryId, pkg.deliveryId),
      });

      if (deliveryItemsList.length > 0) {
        const itemIds = deliveryItemsList.map(di => di.itemId);
        await db.update(items)
          .set({ status: 'in_transit', updatedAt: new Date() })
          .where(inArray(items.id, itemIds));
      }
    }

    // Return updated package with delivery info
    const packageWithRelations = await db.query.deliveryPackages.findFirst({
      where: eq(deliveryPackages.id, updatedPackage.id),
      with: {
        delivery: {
          with: {
            tenant: true,
            deliveryPackages: true,
          },
        },
        scannedByUser: true,
      },
    });

    res.json({
      package: packageWithRelations,
      allPackagesScanned: allScanned,
      totalPackages: allPackages.length,
      scannedPackages: allPackages.filter(p => p.status === 'scanned' || p.id === updatedPackage.id).length,
    });
  } catch (error) {
    console.error('Scan package error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Pick up delivery (driver) - Legacy endpoint, kept for backward compatibility
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

// Deliver to hotel with location tracking
deliveriesRouter.post('/:id/deliver', requireRole('driver', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { latitude, longitude, address } = req.body;
    console.log('📍 Deliver request with location:', { id, latitude, longitude, address });

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

    // Proximity check: Verify driver is close to hotel location
    if (latitude && longitude && existingDelivery.tenant?.latitude && existingDelivery.tenant?.longitude) {
      const driverLat = parseFloat(latitude);
      const driverLon = parseFloat(longitude);
      const hotelLat = parseFloat(existingDelivery.tenant.latitude);
      const hotelLon = parseFloat(existingDelivery.tenant.longitude);

      const distance = calculateDistance(driverLat, driverLon, hotelLat, hotelLon);
      const MAX_DISTANCE = 300; // 300 meters radius

      console.log(`📍 Proximity check: Driver at (${driverLat}, ${driverLon}), Hotel at (${hotelLat}, ${hotelLon}), Distance: ${distance.toFixed(2)}m`);

      if (distance > MAX_DISTANCE) {
        return res.status(400).json({
          error: 'Konum doğrulaması başarısız',
          message: `Otel konumundan ${distance.toFixed(0)} metre uzaktasınız. Teslimat yapmak için otele daha yakın olmalısınız (maksimum ${MAX_DISTANCE}m).`,
          distance: Math.round(distance),
          maxDistance: MAX_DISTANCE
        });
      }

      console.log(`✅ Proximity check passed: ${distance.toFixed(2)}m < ${MAX_DISTANCE}m`);
    } else if (!latitude || !longitude) {
      console.warn('⚠️ No driver location provided for delivery');
    } else if (!existingDelivery.tenant?.latitude || !existingDelivery.tenant?.longitude) {
      console.warn('⚠️ Hotel location not configured, skipping proximity check');
    }

    const [updatedDelivery] = await db.update(deliveries)
      .set({
        status: 'delivered',
        driverId: req.user!.id,
        deliveredAt: new Date(),
        deliveryLatitude: latitude ? String(latitude) : null,
        deliveryLongitude: longitude ? String(longitude) : null,
        deliveryAddress: address || null,
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

// Create bag - group multiple deliveries under a single bag code
deliveriesRouter.post('/create-bag', requireRole('operator', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    const { deliveryIds, tenantId } = req.body;

    if (!deliveryIds || !Array.isArray(deliveryIds) || deliveryIds.length === 0) {
      return res.status(400).json({ error: 'deliveryIds is required and must be a non-empty array' });
    }

    // Generate unique bag code
    const bagCode = `BAG-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

    // Update all deliveries with the bag code
    await db.update(deliveries)
      .set({
        bagCode,
        updatedAt: new Date()
      })
      .where(inArray(deliveries.id, deliveryIds));

    // Get updated deliveries
    const updatedDeliveries = await db.query.deliveries.findMany({
      where: inArray(deliveries.id, deliveryIds),
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
      },
    });

    res.json({
      bagCode,
      deliveryCount: updatedDeliveries.length,
      deliveries: updatedDeliveries,
    });
  } catch (error) {
    console.error('Create bag error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get deliveries by bag code
deliveriesRouter.get('/bag/:bagCode', async (req: AuthRequest, res) => {
  try {
    const { bagCode } = req.params;

    const bagDeliveries = await db.query.deliveries.findMany({
      where: eq(deliveries.bagCode, bagCode),
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
      },
    });

    if (bagDeliveries.length === 0) {
      return res.status(404).json({ error: 'Bag not found' });
    }

    res.json({
      bagCode,
      deliveryCount: bagDeliveries.length,
      deliveries: bagDeliveries,
    });
  } catch (error) {
    console.error('Get bag error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Deliver all packages in a bag
deliveriesRouter.post('/deliver-bag/:bagCode', requireRole('driver', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
  try {
    const { bagCode } = req.params;

    // Find all deliveries with this bag code
    const bagDeliveries = await db.query.deliveries.findMany({
      where: and(
        eq(deliveries.bagCode, bagCode),
        eq(deliveries.status, 'picked_up')
      ),
      with: {
        tenant: true,
        deliveryItems: true,
      },
    });

    if (bagDeliveries.length === 0) {
      return res.status(404).json({ error: 'No deliveries found for this bag code or already delivered' });
    }

    const deliveredIds: string[] = [];
    const errors: string[] = [];

    // Deliver each delivery
    for (const delivery of bagDeliveries) {
      try {
        await db.update(deliveries)
          .set({
            status: 'delivered',
            driverId: req.user!.id,
            deliveredAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(deliveries.id, delivery.id));

        // Update items
        if (delivery.deliveryItems && delivery.deliveryItems.length > 0) {
          const itemIds = delivery.deliveryItems.map(di => di.itemId);
          for (const itemId of itemIds) {
            const item = await db.query.items.findFirst({
              where: eq(items.id, itemId),
            });
            if (item) {
              await db.update(items)
                .set({
                  status: 'at_hotel',
                  washCount: item.washCount + 1,
                  lastWashDate: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(items.id, itemId));
            }
          }
        }

        deliveredIds.push(delivery.id);
      } catch (err) {
        errors.push(`Failed to deliver ${delivery.barcode}`);
      }
    }

    res.json({
      bagCode,
      deliveredCount: deliveredIds.length,
      totalCount: bagDeliveries.length,
      deliveredIds,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Deliver bag error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cancel delivery
deliveriesRouter.post('/:id/cancel', requireRole('packager', 'laundry_manager', 'system_admin'), async (req: AuthRequest, res) => {
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

    // Delete delivery packages
    await db.delete(deliveryPackages).where(eq(deliveryPackages.deliveryId, id));

    // Delete delivery
    await db.delete(deliveries).where(eq(deliveries.id, id));

    res.json({ message: 'Delivery cancelled' });
  } catch (error) {
    console.error('Cancel delivery error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
