import { Router } from 'express';
import { db } from '../db';
import { dirtyDeclarations, tenants } from '../db/schema';
import { eq, and, desc, count } from 'drizzle-orm';
import { requireAuth, AuthRequest, requireRole } from '../middleware/auth';

// Camasirhane/utucu tarafi: otellerin girdigi kirli teslim beyanlarini gorur ve isler.
// Otel tarafi olusturma/listeleme portal.ts icinde (/portal/dirty-declarations).
export const dirtyDeclarationsRouter = Router();

dirtyDeclarationsRouter.use(requireAuth);
dirtyDeclarationsRouter.use(requireRole('laundry_manager', 'system_admin', 'operator', 'ironer'));

interface DirtyDeclLine { itemTypeId: string; itemTypeName: string; count: number; }
function safeParseItems(json: string | null): DirtyDeclLine[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Kirli beyanlari listele (admin liste + utucu paneli icin).
// ?status=pending|processed  ?tenantId=<otel> ile filtrelenebilir.
dirtyDeclarationsRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = (page - 1) * limit;
    const status = req.query.status as string;
    const tenantId = req.query.tenantId as string;

    const conditions = [];
    if (status) conditions.push(eq(dirtyDeclarations.status, status as any));
    if (tenantId) conditions.push(eq(dirtyDeclarations.tenantId, tenantId));
    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    const totalResult = await db.select({ count: count() }).from(dirtyDeclarations).where(whereCondition);
    const total = totalResult[0]?.count || 0;

    const rows = await db.select({
      id: dirtyDeclarations.id,
      tenantId: dirtyDeclarations.tenantId,
      tenantName: tenants.name,
      status: dirtyDeclarations.status,
      items: dirtyDeclarations.items,
      notes: dirtyDeclarations.notes,
      createdAt: dirtyDeclarations.createdAt,
      processedAt: dirtyDeclarations.processedAt,
    })
      .from(dirtyDeclarations)
      .leftJoin(tenants, eq(dirtyDeclarations.tenantId, tenants.id))
      .where(whereCondition)
      .orderBy(desc(dirtyDeclarations.createdAt))
      .limit(limit)
      .offset(offset);

    const data = rows.map(r => ({
      id: r.id,
      tenantId: r.tenantId,
      tenantName: r.tenantName,
      status: r.status,
      items: safeParseItems(r.items),
      notes: r.notes,
      createdAt: r.createdAt,
      processedAt: r.processedAt,
    }));

    res.json({
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('List dirty declarations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bir beyani 'islendi' (processed) olarak isaretle.
// Utucu etiketi basinca otomatik, veya admin/utucu manuel tetikler. Idempotent.
dirtyDeclarationsRouter.post('/:id/process', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const [existing] = await db.select().from(dirtyDeclarations).where(eq(dirtyDeclarations.id, id));
    if (!existing) {
      return res.status(404).json({ error: 'Beyan bulunamadı' });
    }
    if (existing.status === 'processed') {
      return res.json({ id: existing.id, status: existing.status, processedAt: existing.processedAt });
    }

    const [updated] = await db.update(dirtyDeclarations)
      .set({ status: 'processed', processedBy: user.id, processedAt: new Date(), updatedAt: new Date() })
      .where(eq(dirtyDeclarations.id, id))
      .returning();

    res.json({ id: updated.id, status: updated.status, processedAt: updated.processedAt });
  } catch (error) {
    console.error('Process dirty declaration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Belirli bir otelin bekleyen beyanlarini topluca isle (utucu o oteli bitirince).
dirtyDeclarationsRouter.post('/process-by-tenant/:tenantId', async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const { tenantId } = req.params;

    const updated = await db.update(dirtyDeclarations)
      .set({ status: 'processed', processedBy: user.id, processedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(dirtyDeclarations.tenantId, tenantId), eq(dirtyDeclarations.status, 'pending')))
      .returning({ id: dirtyDeclarations.id });

    res.json({ processedCount: updated.length, ids: updated.map(u => u.id) });
  } catch (error) {
    console.error('Process dirty declarations by tenant error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
