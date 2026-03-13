import { Router } from 'express';
import { db } from '../db';
import { tenantPricing, tenants, itemTypes } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuth, AuthRequest, requireRole } from '../middleware/auth';
import { z } from 'zod';

export const tenantPricingRouter = Router();

// Get all prices for a tenant
tenantPricingRouter.get('/:tenantId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { tenantId } = req.params;

    const prices = await db.query.tenantPricing.findMany({
      where: eq(tenantPricing.tenantId, tenantId),
      with: {
        itemType: true,
      },
    });

    // Map to simple format: { itemTypeId, itemTypeName, price }
    const result = prices.map(p => ({
      id: p.id,
      tenantId: p.tenantId,
      itemTypeId: p.itemTypeId,
      itemTypeName: p.itemType?.name || '',
      price: p.price / 100, // kuruş -> TL
      priceKurus: p.price,
    }));

    res.json(result);
  } catch (error) {
    console.error('Get tenant pricing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get prices for a tenant by tenant qrCode (for sync agent - no auth required for internal use)
tenantPricingRouter.get('/by-code/:qrCode', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { qrCode } = req.params;

    // Find tenant by qrCode
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.qrCode, qrCode),
    });

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const prices = await db.query.tenantPricing.findMany({
      where: eq(tenantPricing.tenantId, tenant.id),
      with: {
        itemType: true,
      },
    });

    const result = prices.map(p => ({
      id: p.id,
      tenantId: p.tenantId,
      itemTypeId: p.itemTypeId,
      itemTypeName: p.itemType?.name || '',
      price: p.price / 100,
      priceKurus: p.price,
    }));

    res.json(result);
  } catch (error) {
    console.error('Get tenant pricing by code error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Set/update price for a tenant + item type
const upsertPriceSchema = z.object({
  itemTypeId: z.string().uuid(),
  price: z.number().min(0), // Price in TL (e.g., 15.50)
});

tenantPricingRouter.post('/:tenantId', requireAuth, requireRole('system_admin', 'laundry_manager'), async (req: AuthRequest, res) => {
  try {
    const { tenantId } = req.params;
    const validation = upsertPriceSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
    }

    const { itemTypeId, price } = validation.data;
    const priceKurus = Math.round(price * 100); // TL -> kuruş

    // Check if pricing already exists
    const existing = await db.query.tenantPricing.findFirst({
      where: and(
        eq(tenantPricing.tenantId, tenantId),
        eq(tenantPricing.itemTypeId, itemTypeId),
      ),
    });

    if (existing) {
      // Update
      const [updated] = await db.update(tenantPricing)
        .set({ price: priceKurus, updatedAt: new Date() })
        .where(eq(tenantPricing.id, existing.id))
        .returning();

      res.json({ ...updated, price: updated.price / 100 });
    } else {
      // Insert
      const [created] = await db.insert(tenantPricing)
        .values({ tenantId, itemTypeId, price: priceKurus })
        .returning();

      res.status(201).json({ ...created, price: created.price / 100 });
    }
  } catch (error) {
    console.error('Upsert tenant pricing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk set prices for a tenant
const bulkPriceSchema = z.object({
  prices: z.array(z.object({
    itemTypeId: z.string().uuid(),
    price: z.number().min(0),
  })),
});

tenantPricingRouter.put('/:tenantId', requireAuth, requireRole('system_admin', 'laundry_manager'), async (req: AuthRequest, res) => {
  try {
    const { tenantId } = req.params;
    const validation = bulkPriceSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
    }

    const { prices } = validation.data;
    const results = [];

    for (const item of prices) {
      const priceKurus = Math.round(item.price * 100);

      const existing = await db.query.tenantPricing.findFirst({
        where: and(
          eq(tenantPricing.tenantId, tenantId),
          eq(tenantPricing.itemTypeId, item.itemTypeId),
        ),
      });

      if (existing) {
        const [updated] = await db.update(tenantPricing)
          .set({ price: priceKurus, updatedAt: new Date() })
          .where(eq(tenantPricing.id, existing.id))
          .returning();
        results.push(updated);
      } else {
        const [created] = await db.insert(tenantPricing)
          .values({ tenantId, itemTypeId: item.itemTypeId, price: priceKurus })
          .returning();
        results.push(created);
      }
    }

    res.json({
      success: true,
      count: results.length,
      prices: results.map(r => ({ ...r, price: r.price / 100 })),
    });
  } catch (error) {
    console.error('Bulk set tenant pricing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a price
tenantPricingRouter.delete('/:tenantId/:itemTypeId', requireAuth, requireRole('system_admin', 'laundry_manager'), async (req: AuthRequest, res) => {
  try {
    const { tenantId, itemTypeId } = req.params;

    await db.delete(tenantPricing).where(
      and(
        eq(tenantPricing.tenantId, tenantId),
        eq(tenantPricing.itemTypeId, itemTypeId),
      ),
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Delete tenant pricing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
