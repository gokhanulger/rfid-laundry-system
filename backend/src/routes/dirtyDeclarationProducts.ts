import { Router } from 'express';
import { db } from '../db';
import { dirtyDeclarationProducts } from '../db/schema';
import { eq, asc } from 'drizzle-orm';
import { requireAuth, AuthRequest, requireRole } from '../middleware/auth';
import { z } from 'zod';

// Kirli irsaliye urun listesi: admin yonetir, otel formunda gorunur.
export const dirtyDeclarationProductsRouter = Router();
dirtyDeclarationProductsRouter.use(requireAuth);

// Listele (otel + admin). ?all=1 ile pasifler de gelir (admin ekrani icin).
dirtyDeclarationProductsRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const includeInactive = req.query.all === '1';
    const rows = await db.select()
      .from(dirtyDeclarationProducts)
      .orderBy(asc(dirtyDeclarationProducts.sortOrder), asc(dirtyDeclarationProducts.name));
    const data = (includeInactive ? rows : rows.filter(r => r.isActive)).map(r => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sortOrder,
      isActive: r.isActive,
    }));
    res.json(data);
  } catch (error) {
    console.error('List dirty declaration products error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Mutasyonlar sadece camasirhane yonetimi ---
const adminOnly = requireRole('laundry_manager', 'system_admin');

const createSchema = z.object({
  name: z.string().trim().min(1, 'Ürün adı gerekli').max(100),
  sortOrder: z.number().int().optional(),
});

dirtyDeclarationProductsRouter.post('/', adminOnly, async (req: AuthRequest, res) => {
  try {
    const v = createSchema.safeParse(req.body);
    if (!v.success) return res.status(400).json({ error: 'Doğrulama hatası', details: v.error.errors });

    let sortOrder = v.data.sortOrder;
    if (sortOrder === undefined) {
      // Listenin sonuna ekle
      const rows = await db.select({ s: dirtyDeclarationProducts.sortOrder }).from(dirtyDeclarationProducts);
      const max = rows.reduce((m, r) => Math.max(m, r.s), 0);
      sortOrder = max + 10;
    }

    const [created] = await db.insert(dirtyDeclarationProducts)
      .values({ name: v.data.name.trim(), sortOrder })
      .returning();
    res.status(201).json({ id: created.id, name: created.name, sortOrder: created.sortOrder, isActive: created.isActive });
  } catch (error) {
    console.error('Create dirty declaration product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

dirtyDeclarationProductsRouter.patch('/:id', adminOnly, async (req: AuthRequest, res) => {
  try {
    const v = updateSchema.safeParse(req.body);
    if (!v.success) return res.status(400).json({ error: 'Doğrulama hatası', details: v.error.errors });

    const patch: Record<string, any> = { updatedAt: new Date() };
    if (v.data.name !== undefined) patch.name = v.data.name.trim();
    if (v.data.sortOrder !== undefined) patch.sortOrder = v.data.sortOrder;
    if (v.data.isActive !== undefined) patch.isActive = v.data.isActive;

    const [updated] = await db.update(dirtyDeclarationProducts)
      .set(patch)
      .where(eq(dirtyDeclarationProducts.id, req.params.id))
      .returning();
    if (!updated) return res.status(404).json({ error: 'Ürün bulunamadı' });
    res.json({ id: updated.id, name: updated.name, sortOrder: updated.sortOrder, isActive: updated.isActive });
  } catch (error) {
    console.error('Update dirty declaration product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

dirtyDeclarationProductsRouter.delete('/:id', adminOnly, async (req: AuthRequest, res) => {
  try {
    const [deleted] = await db.delete(dirtyDeclarationProducts)
      .where(eq(dirtyDeclarationProducts.id, req.params.id))
      .returning({ id: dirtyDeclarationProducts.id });
    if (!deleted) return res.status(404).json({ error: 'Ürün bulunamadı' });
    res.json({ id: deleted.id });
  } catch (error) {
    console.error('Delete dirty declaration product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
