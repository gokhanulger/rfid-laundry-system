import { Router } from 'express';
import { db } from '../db';
import { items } from '../db/schema';
import { requireAuth, AuthRequest } from '../middleware/auth';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

// Get lifecycle report
reportsRouter.get('/lifecycle', async (req: AuthRequest, res) => {
  try {
    const { tenantId, startDate, endDate } = req.query;

    // For hotel owners, always filter by their tenant
    const effectiveTenantId = req.user?.role === 'hotel_owner'
      ? req.user.tenantId
      : (tenantId as string | undefined);

    const allItems = await db.query.items.findMany({
      with: {
        itemType: true,
        tenant: true,
      },
    });

    // Filter by tenant if hotel owner or if tenantId provided
    const filteredItems = effectiveTenantId
      ? allItems.filter(item => item.tenantId === effectiveTenantId)
      : allItems;

    // Generate report data
    const report = {
      totalItems: filteredItems.length,
      itemsByStatus: filteredItems.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      averageWashCount: filteredItems.reduce((sum, item) => sum + item.washCount, 0) / filteredItems.length || 0,
      itemsByType: filteredItems.reduce((acc, item) => {
        const typeName = item.itemType?.name || 'Unknown';
        acc[typeName] = (acc[typeName] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };

    res.json(report);
  } catch (error) {
    console.error('Get lifecycle report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

