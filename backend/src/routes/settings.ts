import { Router } from 'express';
import { db } from '../db';
import { tenants, itemTypes, users } from '../db/schema';
import { requireAuth, AuthRequest, requireRole } from '../middleware/auth';
import { eq, isNull } from 'drizzle-orm';
import crypto from 'crypto';

// Generate a unique QR code for hotel
function generateQRCode(): string {
  return `HTL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

// Get all tenants (operators and above can view for tag assignment)
settingsRouter.get('/tenants', async (req: AuthRequest, res) => {
  try {
    const allTenants = await db.query.tenants.findMany({
      columns: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        qrCode: true,
      }
    });
    res.json(allTenants);
  } catch (error) {
    console.error('Get tenants error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get tenant by QR code (for quick hotel selection via QR scan)
settingsRouter.get('/tenants/qr/:qrCode', async (req: AuthRequest, res) => {
  try {
    const { qrCode } = req.params;

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.qrCode, qrCode),
      columns: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        qrCode: true,
      }
    });

    if (!tenant) {
      return res.status(404).json({ error: 'Hotel not found with this QR code' });
    }

    res.json(tenant);
  } catch (error) {
    console.error('Get tenant by QR error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create tenant (admin only)
settingsRouter.post('/tenants', requireRole('system_admin'), async (req: AuthRequest, res) => {
  try {
    const { name, email, phone, address } = req.body;

    // Generate unique QR code
    const qrCode = generateQRCode();

    const [newTenant] = await db.insert(tenants).values({
      name,
      email,
      phone,
      address,
      qrCode,
    }).returning();

    res.status(201).json(newTenant);
  } catch (error) {
    console.error('Create tenant error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update tenant (admin only) - qrCode dahil
settingsRouter.patch('/tenants/:id', requireRole('system_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, address, qrCode } = req.body;

    const existingTenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, id),
    });

    if (!existingTenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const updateData: any = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (address !== undefined) updateData.address = address;
    if (qrCode !== undefined) updateData.qrCode = qrCode;

    const [updatedTenant] = await db.update(tenants)
      .set(updateData)
      .where(eq(tenants.id, id))
      .returning();

    res.json(updatedTenant);
  } catch (error) {
    console.error('Update tenant error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Assign QR codes to existing tenants without one
settingsRouter.post('/tenants/generate-qr-codes', requireRole('system_admin'), async (req: AuthRequest, res) => {
  try {
    // Find tenants without QR codes
    const tenantsWithoutQR = await db.query.tenants.findMany({
      where: isNull(tenants.qrCode),
    });

    const updated = [];
    for (const tenant of tenantsWithoutQR) {
      const qrCode = generateQRCode();
      await db.update(tenants)
        .set({ qrCode, updatedAt: new Date() })
        .where(eq(tenants.id, tenant.id));
      updated.push({ id: tenant.id, name: tenant.name, qrCode });
    }

    res.json({
      message: `QR codes generated for ${updated.length} hotels`,
      hotels: updated
    });
  } catch (error) {
    console.error('Generate QR codes error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get item types
settingsRouter.get('/item-types', async (req: AuthRequest, res) => {
  try {
    const allItemTypes = await db.query.itemTypes.findMany();
    res.json(allItemTypes);
  } catch (error) {
    console.error('Get item types error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create item type
settingsRouter.post('/item-types', async (req: AuthRequest, res) => {
  try {
    const { name, description, tenantId } = req.body;

    const [newItemType] = await db.insert(itemTypes).values({
      name,
      description,
      tenantId: tenantId || null,
    }).returning();

    res.status(201).json(newItemType);
  } catch (error) {
    console.error('Create item type error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

