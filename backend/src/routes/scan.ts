import { Router } from 'express';
import { db } from '../db';
import {
  scanSessions,
  scanEvents,
  devices,
  items,
  offlineSyncQueue,
  scanConflicts,
  pickups,
  pickupItems,
  deliveries,
  deliveryItems,
  auditLogs
} from '../db/schema';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { requireAuth, AuthRequest, requireRole } from '../middleware/auth';
import { z } from 'zod';

export const scanRouter = Router();
scanRouter.use(requireAuth);

// Helper function to find item by partial RFID match
// Searches for database rfidTag within the scanned tag (e.g., "903425" found in "E2000000903425...")
async function findItemByPartialRfidMatch(scannedTag: string, tenantId?: string) {
  // Get all items (optionally filtered by tenant)
  const conditions = tenantId ? eq(items.tenantId, tenantId) : undefined;
  const allItems = await db.query.items.findMany({
    where: conditions,
  });

  // Find item whose rfidTag is contained within the scanned tag
  return allItems.find(item => scannedTag.includes(item.rfidTag));
}

// Helper function to match multiple scanned tags to items
async function matchScannedTagsToItems(scannedTags: string[], tenantId?: string): Promise<Map<string, string>> {
  // Get all items (optionally filtered by tenant)
  const conditions = tenantId ? eq(items.tenantId, tenantId) : undefined;
  const allItems = await db.query.items.findMany({
    where: conditions,
  });

  // Create a map of scannedTag -> itemId
  const matchMap = new Map<string, string>();

  for (const scannedTag of scannedTags) {
    const matchedItem = allItems.find(item => scannedTag.includes(item.rfidTag));
    if (matchedItem) {
      matchMap.set(scannedTag, matchedItem.id);
    }
  }

  return matchMap;
}

// Validation schemas
const sessionTypeEnum = z.enum(['pickup', 'receive', 'process', 'clean', 'package', 'deliver']);

const startSessionSchema = z.object({
  deviceUuid: z.string().optional(), // Optional for web-based scanning
  sessionType: sessionTypeEnum,
  relatedEntityType: z.string().optional(),
  relatedEntityId: z.string().uuid().optional(),
  metadata: z.record(z.any()).optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
});

const endSessionSchema = z.object({
  itemCount: z.number().int().min(0).optional(),
  metadata: z.record(z.any()).optional(),
});

const bulkScanSchema = z.object({
  sessionId: z.string().uuid(),
  scans: z.array(z.object({
    rfidTag: z.string().min(1),
    signalStrength: z.number().int().optional(),
    scannedAt: z.string().datetime().optional(),
  })).min(1),
});

const offlineSyncSchema = z.object({
  deviceUuid: z.string(),
  sessions: z.array(z.object({
    localId: z.string(), // Local ID from device for reference
    sessionType: sessionTypeEnum,
    relatedEntityType: z.string().optional(),
    relatedEntityId: z.string().uuid().optional(),
    metadata: z.record(z.any()).optional(),
    latitude: z.string().optional(),
    longitude: z.string().optional(),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
    scans: z.array(z.object({
      rfidTag: z.string(),
      signalStrength: z.number().int().optional(),
      readCount: z.number().int().optional(),
      scannedAt: z.string().datetime(),
    })),
  })),
});

// Start a new scanning session
scanRouter.post('/session/start', async (req: AuthRequest, res) => {
  try {
    const validation = startSessionSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.errors[0].message });
    }

    const { deviceUuid, sessionType, relatedEntityType, relatedEntityId, metadata, latitude, longitude } = validation.data;
    const user = req.user!;

    // Find device if deviceUuid provided
    let deviceId: string | null = null;
    if (deviceUuid) {
      const device = await db.query.devices.findFirst({
        where: eq(devices.deviceUuid, deviceUuid),
      });
      if (device) {
        deviceId = device.id;
        // Update device last seen
        await db.update(devices)
          .set({ lastSeenAt: new Date() })
          .where(eq(devices.id, device.id));
      }
    }

    // Create session
    const [session] = await db.insert(scanSessions)
      .values({
        deviceId,
        userId: user.id,
        tenantId: user.tenantId!,
        sessionType,
        relatedEntityType,
        relatedEntityId,
        metadata: metadata ? JSON.stringify(metadata) : null,
        latitude,
        longitude,
        status: 'in_progress',
      })
      .returning();

    // Audit log
    await db.insert(auditLogs).values({
      userId: user.id,
      tenantId: user.tenantId,
      action: 'scan_session_started',
      entityType: 'scan_session',
      entityId: session.id,
      details: JSON.stringify({ sessionType, deviceId }),
    });

    res.status(201).json(session);
  } catch (error) {
    console.error('Error starting scan session:', error);
    res.status(500).json({ error: 'Failed to start scan session' });
  }
});

// End a scanning session
scanRouter.post('/session/:id/end', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const validation = endSessionSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.errors[0].message });
    }

    // Find session
    const session = await db.query.scanSessions.findFirst({
      where: eq(scanSessions.id, id),
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Tenant isolation
    if (user.role !== 'system_admin' && user.tenantId && session.tenantId !== user.tenantId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Count scanned items
    const scanCount = await db.select({ count: sql<number>`count(*)` })
      .from(scanEvents)
      .where(eq(scanEvents.sessionId, id));

    const itemCount = validation.data.itemCount ?? Number(scanCount[0]?.count || 0);

    // Update session
    const [updatedSession] = await db.update(scanSessions)
      .set({
        status: 'completed',
        completedAt: new Date(),
        itemCount,
        metadata: validation.data.metadata
          ? JSON.stringify({ ...JSON.parse(session.metadata || '{}'), ...validation.data.metadata })
          : session.metadata,
      })
      .where(eq(scanSessions.id, id))
      .returning();

    // Process scanned items based on session type
    await processSessionItems(session, user.id);

    // Audit log
    await db.insert(auditLogs).values({
      userId: user.id,
      tenantId: user.tenantId,
      action: 'scan_session_completed',
      entityType: 'scan_session',
      entityId: session.id,
      details: JSON.stringify({ itemCount }),
    });

    res.json(updatedSession);
  } catch (error) {
    console.error('Error ending scan session:', error);
    res.status(500).json({ error: 'Failed to end scan session' });
  }
});

// Submit bulk scans to a session
scanRouter.post('/bulk', async (req: AuthRequest, res) => {
  try {
    const validation = bulkScanSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.errors[0].message });
    }

    const { sessionId, scans } = validation.data;
    const user = req.user!;

    // Find session
    const session = await db.query.scanSessions.findFirst({
      where: eq(scanSessions.id, sessionId),
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Tenant isolation
    if (user.role !== 'system_admin' && user.tenantId && session.tenantId !== user.tenantId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (session.status !== 'in_progress') {
      return res.status(400).json({ error: 'Session is not in progress' });
    }

    // Deduplicate scans by rfidTag (keep highest signal strength)
    const uniqueScans = new Map<string, typeof scans[0]>();
    for (const scan of scans) {
      const existing = uniqueScans.get(scan.rfidTag);
      if (!existing || (scan.signalStrength || 0) > (existing.signalStrength || 0)) {
        uniqueScans.set(scan.rfidTag, scan);
      }
    }

    // Get existing scans in session to update read count
    const existingScans = await db.query.scanEvents.findMany({
      where: eq(scanEvents.sessionId, sessionId),
    });
    const existingTagMap = new Map(existingScans.map(s => [s.rfidTag, s]));

    // Separate new scans vs updates
    const newScans: typeof scans = [];
    const updateScans: { id: string; readCount: number; signalStrength?: number }[] = [];

    for (const [rfidTag, scan] of uniqueScans) {
      const existing = existingTagMap.get(rfidTag);
      if (existing) {
        updateScans.push({
          id: existing.id,
          readCount: existing.readCount + 1,
          signalStrength: Math.max(existing.signalStrength || 0, scan.signalStrength || 0),
        });
      } else {
        newScans.push(scan);
      }
    }

    // Insert new scans
    if (newScans.length > 0) {
      // Look up item IDs for the RFID tags using partial match
      // This allows matching when scanned tag contains the database tag (e.g., "E2000090342512101401321502F338..." contains "90342512101401321502F338")
      const rfidTags = newScans.map(s => s.rfidTag);
      const itemMap = await matchScannedTagsToItems(rfidTags, session.tenantId);

      await db.insert(scanEvents).values(
        newScans.map(scan => ({
          sessionId,
          rfidTag: scan.rfidTag,
          itemId: itemMap.get(scan.rfidTag) || null,
          signalStrength: scan.signalStrength,
          scannedAt: scan.scannedAt ? new Date(scan.scannedAt) : new Date(),
        }))
      );
    }

    // Update existing scans
    for (const update of updateScans) {
      await db.update(scanEvents)
        .set({
          readCount: update.readCount,
          signalStrength: update.signalStrength,
        })
        .where(eq(scanEvents.id, update.id));
    }

    // Update session item count
    const totalCount = await db.select({ count: sql<number>`count(*)` })
      .from(scanEvents)
      .where(eq(scanEvents.sessionId, sessionId));

    await db.update(scanSessions)
      .set({ itemCount: Number(totalCount[0]?.count || 0) })
      .where(eq(scanSessions.id, sessionId));

    res.json({
      added: newScans.length,
      updated: updateScans.length,
      total: Number(totalCount[0]?.count || 0),
    });
  } catch (error) {
    console.error('Error processing bulk scans:', error);
    res.status(500).json({ error: 'Failed to process bulk scans' });
  }
});

// Sync offline sessions from Android device
scanRouter.post('/sync', async (req: AuthRequest, res) => {
  try {
    const validation = offlineSyncSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.errors[0].message });
    }

    const { deviceUuid, sessions: offlineSessions } = validation.data;
    const user = req.user!;

    // Find device
    const device = await db.query.devices.findFirst({
      where: eq(devices.deviceUuid, deviceUuid),
    });

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const results: {
      localId: string;
      serverId?: string;
      status: 'synced' | 'conflict' | 'error';
      conflicts?: string[];
      error?: string;
    }[] = [];

    for (const offlineSession of offlineSessions) {
      try {
        // Create session
        const [session] = await db.insert(scanSessions)
          .values({
            deviceId: device.id,
            userId: user.id,
            tenantId: user.tenantId!,
            sessionType: offlineSession.sessionType,
            relatedEntityType: offlineSession.relatedEntityType,
            relatedEntityId: offlineSession.relatedEntityId,
            metadata: offlineSession.metadata ? JSON.stringify(offlineSession.metadata) : null,
            latitude: offlineSession.latitude,
            longitude: offlineSession.longitude,
            status: 'synced',
            startedAt: new Date(offlineSession.startedAt),
            completedAt: offlineSession.completedAt ? new Date(offlineSession.completedAt) : null,
            syncedAt: new Date(),
            itemCount: offlineSession.scans.length,
          })
          .returning();

        // Check for conflicts with other sessions
        const conflicts: string[] = [];

        if (offlineSession.scans.length > 0) {
          // Look up item IDs using partial match
          // This allows matching when scanned tag contains the database tag
          const rfidTags = offlineSession.scans.map(s => s.rfidTag);
          const itemMap = await matchScannedTagsToItems(rfidTags, user.tenantId || undefined);

          // Check for same tags scanned in same session type recently (potential conflict)
          for (const scan of offlineSession.scans) {
            const existingEvent = await db.query.scanEvents.findFirst({
              where: and(
                eq(scanEvents.rfidTag, scan.rfidTag),
                eq(scanEvents.syncStatus, 'synced')
              ),
              with: {
                session: true,
              },
            });

            // If same tag was scanned in same session type by another device recently
            if (existingEvent && existingEvent.session?.sessionType === offlineSession.sessionType) {
              const timeDiff = new Date(scan.scannedAt).getTime() - existingEvent.scannedAt.getTime();
              // If within 1 hour, flag as potential conflict
              if (Math.abs(timeDiff) < 60 * 60 * 1000) {
                conflicts.push(scan.rfidTag);

                // Record conflict
                await db.insert(scanConflicts).values({
                  rfidTag: scan.rfidTag,
                  winningSessionId: existingEvent.sessionId,
                  conflictingSessionId: session.id,
                  winningDeviceId: existingEvent.session?.deviceId,
                  conflictingDeviceId: device.id,
                  resolution: 'auto_first_wins',
                  isResolved: true,
                  resolvedAt: new Date(),
                });
              }
            }
          }

          // Insert scan events
          await db.insert(scanEvents).values(
            offlineSession.scans.map(scan => ({
              sessionId: session.id,
              rfidTag: scan.rfidTag,
              itemId: itemMap.get(scan.rfidTag) || null,
              signalStrength: scan.signalStrength,
              readCount: scan.readCount || 1,
              syncStatus: conflicts.includes(scan.rfidTag) ? 'conflict' as const : 'synced' as const,
              scannedAt: new Date(scan.scannedAt),
            }))
          );
        }

        // Process items based on session type
        await processSessionItems(session, user.id);

        results.push({
          localId: offlineSession.localId,
          serverId: session.id,
          status: conflicts.length > 0 ? 'conflict' : 'synced',
          conflicts: conflicts.length > 0 ? conflicts : undefined,
        });
      } catch (sessionError: any) {
        results.push({
          localId: offlineSession.localId,
          status: 'error',
          error: sessionError.message,
        });
      }
    }

    // Update device sync timestamp
    await db.update(devices)
      .set({
        lastSyncAt: new Date(),
        lastSeenAt: new Date(),
      })
      .where(eq(devices.id, device.id));

    res.json({
      syncedAt: new Date().toISOString(),
      results,
    });
  } catch (error) {
    console.error('Error syncing offline sessions:', error);
    res.status(500).json({ error: 'Failed to sync offline sessions' });
  }
});

// Get sync status for a device
scanRouter.get('/sync/status', async (req: AuthRequest, res) => {
  try {
    const { deviceUuid } = req.query;
    const user = req.user!;

    if (!deviceUuid) {
      return res.status(400).json({ error: 'deviceUuid is required' });
    }

    const device = await db.query.devices.findFirst({
      where: eq(devices.deviceUuid, deviceUuid as string),
    });

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Get pending sync count
    const pendingCount = await db.select({ count: sql<number>`count(*)` })
      .from(offlineSyncQueue)
      .where(and(
        eq(offlineSyncQueue.deviceId, device.id),
        eq(offlineSyncQueue.status, 'pending')
      ));

    // Get recent sessions
    const recentSessions = await db.query.scanSessions.findMany({
      where: eq(scanSessions.deviceId, device.id),
      limit: 5,
      orderBy: [desc(scanSessions.createdAt)],
    });

    res.json({
      deviceId: device.id,
      lastSyncAt: device.lastSyncAt,
      lastSeenAt: device.lastSeenAt,
      pendingSyncs: Number(pendingCount[0]?.count || 0),
      recentSessions,
    });
  } catch (error) {
    console.error('Error getting sync status:', error);
    res.status(500).json({ error: 'Failed to get sync status' });
  }
});

// Get session details
scanRouter.get('/session/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const session = await db.query.scanSessions.findFirst({
      where: eq(scanSessions.id, id),
      with: {
        device: true,
        user: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        scanEvents: {
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

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Tenant isolation
    if (user.role !== 'system_admin' && user.tenantId && session.tenantId !== user.tenantId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(session);
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// Get all sessions with pagination
scanRouter.get('/sessions', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const { sessionType, status, deviceId } = req.query;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;

    const conditions = [];

    // Tenant isolation
    if (user.role !== 'system_admin' && user.tenantId) {
      conditions.push(eq(scanSessions.tenantId, user.tenantId));
    }

    if (sessionType) {
      conditions.push(eq(scanSessions.sessionType, sessionType as any));
    }

    if (status) {
      conditions.push(eq(scanSessions.status, status as any));
    }

    if (deviceId) {
      conditions.push(eq(scanSessions.deviceId, deviceId as string));
    }

    const sessions = await db.query.scanSessions.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      limit,
      offset,
      orderBy: [desc(scanSessions.createdAt)],
      with: {
        device: {
          columns: {
            id: true,
            name: true,
          },
        },
        user: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    // Get total count
    const allSessions = await db.query.scanSessions.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
    });

    res.json({
      data: sessions,
      pagination: {
        page,
        limit,
        total: allSessions.length,
        totalPages: Math.ceil(allSessions.length / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Get conflicts
scanRouter.get('/conflicts', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const { resolved } = req.query;

    const conditions = [];

    if (resolved === 'false') {
      conditions.push(eq(scanConflicts.isResolved, false));
    } else if (resolved === 'true') {
      conditions.push(eq(scanConflicts.isResolved, true));
    }

    const conflicts = await db.query.scanConflicts.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [desc(scanConflicts.createdAt)],
      with: {
        winningSession: true,
        conflictingSession: true,
        winningDevice: {
          columns: { id: true, name: true },
        },
        conflictingDevice: {
          columns: { id: true, name: true },
        },
      },
    });

    res.json({ data: conflicts });
  } catch (error) {
    console.error('Error fetching conflicts:', error);
    res.status(500).json({ error: 'Failed to fetch conflicts' });
  }
});

// Resolve a conflict manually
scanRouter.post('/conflicts/:id/resolve', requireRole('system_admin', 'laundry_manager'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { resolution, winningSessionId } = req.body;
    const user = req.user!;

    const conflict = await db.query.scanConflicts.findFirst({
      where: eq(scanConflicts.id, id),
    });

    if (!conflict) {
      return res.status(404).json({ error: 'Conflict not found' });
    }

    const [updatedConflict] = await db.update(scanConflicts)
      .set({
        isResolved: true,
        resolvedAt: new Date(),
        resolvedBy: user.id,
        resolution: resolution || 'manual_override',
        winningSessionId: winningSessionId || conflict.winningSessionId,
      })
      .where(eq(scanConflicts.id, id))
      .returning();

    res.json(updatedConflict);
  } catch (error) {
    console.error('Error resolving conflict:', error);
    res.status(500).json({ error: 'Failed to resolve conflict' });
  }
});

// Helper function to process scanned items based on session type
async function processSessionItems(session: typeof scanSessions.$inferSelect, _userId: string) {
  // Get all scan events for this session
  const events = await db.query.scanEvents.findMany({
    where: eq(scanEvents.sessionId, session.id),
  });

  if (events.length === 0) return;

  const rfidTags = events.map(e => e.rfidTag);

  // Find matching items using partial match
  // This allows matching when scanned tag contains the database tag
  const itemMap = await matchScannedTagsToItems(rfidTags, session.tenantId);

  // Get unique item IDs that matched
  const itemIds = [...new Set(itemMap.values())];

  if (itemIds.length === 0) return;

  // Update item status based on session type
  switch (session.sessionType) {
    case 'pickup':
      // Items picked up from hotel -> at_laundry
      await db.update(items)
        .set({ status: 'at_laundry', updatedAt: new Date() })
        .where(inArray(items.id, itemIds));

      // If session has related pickup, add items to it
      if (session.relatedEntityId && session.relatedEntityType === 'pickup') {
        const existingPickupItems = await db.query.pickupItems.findMany({
          where: eq(pickupItems.pickupId, session.relatedEntityId),
        });
        const existingItemIds = new Set(existingPickupItems.map(pi => pi.itemId));

        const newPickupItems = itemIds.filter(id => !existingItemIds.has(id));
        if (newPickupItems.length > 0) {
          await db.insert(pickupItems).values(
            newPickupItems.map(itemId => ({
              pickupId: session.relatedEntityId!,
              itemId,
            }))
          );
        }
      }
      break;

    case 'receive':
      // Items received at laundry
      await db.update(items)
        .set({ status: 'at_laundry', updatedAt: new Date() })
        .where(inArray(items.id, itemIds));
      break;

    case 'process':
      // Items entering processing/wash
      await db.update(items)
        .set({
          status: 'processing',
          updatedAt: new Date(),
          washCount: sql`${items.washCount} + 1`,
          lastWashDate: new Date(),
        })
        .where(inArray(items.id, itemIds));
      break;

    case 'clean':
      // Items marked clean after ironing
      await db.update(items)
        .set({ status: 'ready_for_delivery', updatedAt: new Date() })
        .where(inArray(items.id, itemIds));
      break;

    case 'package':
      // Items being packaged
      await db.update(items)
        .set({ status: 'packaged', updatedAt: new Date() })
        .where(inArray(items.id, itemIds));

      // If session has related delivery, add items to it
      if (session.relatedEntityId && session.relatedEntityType === 'delivery') {
        const existingDeliveryItems = await db.query.deliveryItems.findMany({
          where: eq(deliveryItems.deliveryId, session.relatedEntityId),
        });
        const existingItemIds = new Set(existingDeliveryItems.map(di => di.itemId));

        const newDeliveryItems = itemIds.filter(id => !existingItemIds.has(id));
        if (newDeliveryItems.length > 0) {
          await db.insert(deliveryItems).values(
            newDeliveryItems.map(itemId => ({
              deliveryId: session.relatedEntityId!,
              itemId,
            }))
          );
        }
      }
      break;

    case 'deliver':
      // Items delivered to hotel
      await db.update(items)
        .set({ status: 'delivered', updatedAt: new Date() })
        .where(inArray(items.id, itemIds));

      // Then mark as at_hotel after delivery
      await db.update(items)
        .set({ status: 'at_hotel', updatedAt: new Date() })
        .where(inArray(items.id, itemIds));
      break;
  }

  // Update scan events with item IDs (using partial match results)
  for (const event of events) {
    const itemId = itemMap.get(event.rfidTag);
    if (itemId && !event.itemId) {
      await db.update(scanEvents)
        .set({ itemId, syncStatus: 'synced' })
        .where(eq(scanEvents.id, event.id));
    }
  }
}
