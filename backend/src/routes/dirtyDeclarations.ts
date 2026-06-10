import { Router } from 'express';
import { db } from '../db';
import { dirtyDeclarations, tenants } from '../db/schema';
import { eq, and, desc, count, gte, isNull, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, AuthRequest, requireRole } from '../middleware/auth';

// Camasirhane/utucu tarafi: otellerin girdigi kirli teslim beyanlarini gorur ve isler.
// Otel tarafi olusturma/listeleme portal.ts icinde (/portal/dirty-declarations).
export const dirtyDeclarationsRouter = Router();

dirtyDeclarationsRouter.use(requireAuth);
dirtyDeclarationsRouter.use(requireRole('laundry_manager', 'system_admin', 'operator', 'ironer'));

interface DirtyDeclLine { itemTypeName: string; count: number; }
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
// ?status=pending|processed  ?tenantId=<otel>  ?days=60 (geriye donuk)  ?includeMerged=1
dirtyDeclarationsRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = (page - 1) * limit;
    const status = req.query.status as string;
    const tenantId = req.query.tenantId as string;
    const includeMerged = req.query.includeMerged === '1';
    // 60 gun geriye donuk takip (varsayilan 60)
    const days = Math.min(parseInt(req.query.days as string) || 60, 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const conditions: any[] = [gte(dirtyDeclarations.createdAt, since)];
    if (status) conditions.push(eq(dirtyDeclarations.status, status as any));
    if (tenantId) conditions.push(eq(dirtyDeclarations.tenantId, tenantId));
    // Birlestirilmis (baska beyana katilmis) beyanlari varsayilan olarak gizle
    if (!includeMerged) conditions.push(isNull(dirtyDeclarations.mergedIntoId));
    const whereCondition = and(...conditions);

    const totalResult = await db.select({ count: count() }).from(dirtyDeclarations).where(whereCondition);
    const total = totalResult[0]?.count || 0;

    const rows = await db.select({
      id: dirtyDeclarations.id,
      declarationNo: dirtyDeclarations.declarationNo,
      tenantId: dirtyDeclarations.tenantId,
      tenantName: tenants.name,
      status: dirtyDeclarations.status,
      items: dirtyDeclarations.items,
      notes: dirtyDeclarations.notes,
      mergedIntoId: dirtyDeclarations.mergedIntoId,
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
      declarationNo: r.declarationNo,
      tenantId: r.tenantId,
      tenantName: r.tenantName,
      status: r.status,
      items: safeParseItems(r.items),
      notes: r.notes,
      mergedIntoId: r.mergedIntoId,
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

// Birden cok kirli beyani TEK irsaliyede birlestir (utucu: az veren gunleri sonraki ile birlestir).
// Hedef = en kucuk declarationNo'lu beyan; digerleri ona katilir (items toplanir, ayni isim birlesir).
const mergeSchema = z.object({ ids: z.array(z.string().uuid()).min(2, 'En az iki irsaliye secin') });
dirtyDeclarationsRouter.post('/merge', async (req: AuthRequest, res) => {
  try {
    const v = mergeSchema.safeParse(req.body);
    if (!v.success) return res.status(400).json({ error: 'Doğrulama hatası', details: v.error.errors });

    const rows = await db.select().from(dirtyDeclarations).where(inArray(dirtyDeclarations.id, v.data.ids));
    if (rows.length < 2) return res.status(400).json({ error: 'Birleştirilecek beyanlar bulunamadı' });

    // Hepsi ayni otel olmali ve hic biri zaten birlestirilmemis/islenmemis olmali
    const tenantIds = new Set(rows.map(r => r.tenantId));
    if (tenantIds.size > 1) return res.status(400).json({ error: 'Sadece ayni otelin irsaliyeleri birleştirilebilir' });
    if (rows.some(r => r.mergedIntoId)) return res.status(400).json({ error: 'Zaten birleştirilmiş irsaliye var' });

    // Hedef: en kucuk declarationNo (yoksa en eski)
    const target = [...rows].sort((a, b) =>
      (a.declarationNo ?? Number.MAX_SAFE_INTEGER) - (b.declarationNo ?? Number.MAX_SAFE_INTEGER)
      || a.createdAt.getTime() - b.createdAt.getTime()
    )[0];
    const sources = rows.filter(r => r.id !== target.id);

    // Tum item'lari isim bazinda topla
    const merged = new Map<string, number>();
    for (const r of rows) {
      for (const it of safeParseItems(r.items)) {
        merged.set(it.itemTypeName, (merged.get(it.itemTypeName) || 0) + it.count);
      }
    }
    const itemsJson = [...merged.entries()].map(([itemTypeName, c]) => ({ itemTypeName, count: c }));

    // Notlari birlestir
    const notes = rows.map(r => r.notes).filter(Boolean).join(' | ') || null;

    await db.update(dirtyDeclarations)
      .set({ items: JSON.stringify(itemsJson), notes, status: 'pending', updatedAt: new Date() })
      .where(eq(dirtyDeclarations.id, target.id));

    await db.update(dirtyDeclarations)
      .set({ mergedIntoId: target.id, updatedAt: new Date() })
      .where(inArray(dirtyDeclarations.id, sources.map(s => s.id)));

    res.json({ targetId: target.id, mergedCount: sources.length });
  } catch (error) {
    console.error('Merge dirty declarations error:', error);
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
