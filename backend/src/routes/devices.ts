import { Router } from 'express';
import { db } from '../db';
import { devices, users } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { requireAuth, AuthRequest, requireRole } from '../middleware/auth';
import { z } from 'zod';

export const devicesRouter = Router();

// Validation schemas
const registerDeviceSchema = z.object({
  deviceUuid: z.string().min(1, 'Device UUID is required'),
  name: z.string().min(1, 'Device name is required'),
  appVersion: z.string().optional(),
});

const updateDeviceSchema = z.object({
  name: z.string().min(1).optional(),
  userId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

// Register a new device (or return existing)
// This endpoint doesn't require auth initially - device registers itself
devicesRouter.post('/register', requireAuth, async (req: AuthRequest, res) => {
  try {
    const validation = registerDeviceSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.errors[0].message });
    }

    const { deviceUuid, name, appVersion } = validation.data;
    const user = req.user!;

    // Check if device already exists
    const existingDevice = await db.query.devices.findFirst({
      where: eq(devices.deviceUuid, deviceUuid),
    });

    if (existingDevice) {
      // Update last seen and app version
      const [updatedDevice] = await db.update(devices)
        .set({
          lastSeenAt: new Date(),
          appVersion: appVersion || existingDevice.appVersion,
          updatedAt: new Date(),
        })
        .where(eq(devices.id, existingDevice.id))
        .returning();

      return res.json({
        device: updatedDevice,
        isNew: false,
      });
    }

    // Create new device
    const [newDevice] = await db.insert(devices)
      .values({
        deviceUuid,
        name,
        userId: user.id,
        tenantId: user.tenantId,
        appVersion,
        lastSeenAt: new Date(),
      })
      .returning();

    res.status(201).json({
      device: newDevice,
      isNew: true,
    });
  } catch (error) {
    console.error('Error registering device:', error);
    res.status(500).json({ error: 'Failed to register device' });
  }
});

// Get all devices for tenant
devicesRouter.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;

    const conditions = [];

    // Tenant isolation
    if (user.role !== 'system_admin' && user.tenantId) {
      conditions.push(eq(devices.tenantId, user.tenantId));
    }

    const allDevices = await db.query.devices.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [desc(devices.lastSeenAt)],
      with: {
        user: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    res.json({ data: allDevices });
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

// Get single device by ID
devicesRouter.get('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const device = await db.query.devices.findFirst({
      where: eq(devices.id, id),
      with: {
        user: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
        scanSessions: {
          limit: 10,
          orderBy: [desc(devices.createdAt)],
        },
      },
    });

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Tenant isolation
    if (user.role !== 'system_admin' && user.tenantId && device.tenantId !== user.tenantId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(device);
  } catch (error) {
    console.error('Error fetching device:', error);
    res.status(500).json({ error: 'Failed to fetch device' });
  }
});

// Update device
devicesRouter.put('/:id', requireAuth, requireRole('system_admin', 'laundry_manager'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const validation = updateDeviceSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.errors[0].message });
    }

    // Check device exists and belongs to tenant
    const existingDevice = await db.query.devices.findFirst({
      where: eq(devices.id, id),
    });

    if (!existingDevice) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Tenant isolation
    if (user.role !== 'system_admin' && user.tenantId && existingDevice.tenantId !== user.tenantId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [updatedDevice] = await db.update(devices)
      .set({
        ...validation.data,
        updatedAt: new Date(),
      })
      .where(eq(devices.id, id))
      .returning();

    res.json(updatedDevice);
  } catch (error) {
    console.error('Error updating device:', error);
    res.status(500).json({ error: 'Failed to update device' });
  }
});

// Deactivate device
devicesRouter.post('/:id/deactivate', requireAuth, requireRole('system_admin', 'laundry_manager'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const existingDevice = await db.query.devices.findFirst({
      where: eq(devices.id, id),
    });

    if (!existingDevice) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Tenant isolation
    if (user.role !== 'system_admin' && user.tenantId && existingDevice.tenantId !== user.tenantId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [updatedDevice] = await db.update(devices)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(devices.id, id))
      .returning();

    res.json(updatedDevice);
  } catch (error) {
    console.error('Error deactivating device:', error);
    res.status(500).json({ error: 'Failed to deactivate device' });
  }
});

// Activate device
devicesRouter.post('/:id/activate', requireAuth, requireRole('system_admin', 'laundry_manager'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const existingDevice = await db.query.devices.findFirst({
      where: eq(devices.id, id),
    });

    if (!existingDevice) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Tenant isolation
    if (user.role !== 'system_admin' && user.tenantId && existingDevice.tenantId !== user.tenantId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [updatedDevice] = await db.update(devices)
      .set({
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(devices.id, id))
      .returning();

    res.json(updatedDevice);
  } catch (error) {
    console.error('Error activating device:', error);
    res.status(500).json({ error: 'Failed to activate device' });
  }
});

// Heartbeat - device pings this to update lastSeenAt
devicesRouter.post('/:deviceUuid/heartbeat', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { deviceUuid } = req.params;
    const { appVersion } = req.body;

    const existingDevice = await db.query.devices.findFirst({
      where: eq(devices.deviceUuid, deviceUuid),
    });

    if (!existingDevice) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const [updatedDevice] = await db.update(devices)
      .set({
        lastSeenAt: new Date(),
        appVersion: appVersion || existingDevice.appVersion,
      })
      .where(eq(devices.id, existingDevice.id))
      .returning();

    res.json({
      status: 'ok',
      lastSeenAt: updatedDevice.lastSeenAt,
    });
  } catch (error) {
    console.error('Error updating heartbeat:', error);
    res.status(500).json({ error: 'Failed to update heartbeat' });
  }
});
