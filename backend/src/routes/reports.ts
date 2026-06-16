import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { items } from '../db/schema';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { sendDailyCiroWhatsApp } from '../services/whatsapp';

export const reportsRouter = Router();

// ---------------------------------------------------------------------------
// GUNLUK CIRO RAPORU — WhatsApp (her gun gece 00:30 TR, GitHub Actions cron tetikler)
// Auth YOK; CRON_SECRET ile korunur. requireAuth'tan ONCE tanimlanir.
//   POST /api/reports/daily-ciro   header: x-cron-secret: <CRON_SECRET>
//   ops query: ?date=YYYY-MM-DD (test icin), ?force=1 (ayni gun tekrar gonder)
// Ciro = o gun (TR) printed_at olan irsaliyelerin urunleri x tenant_pricing.
// ---------------------------------------------------------------------------
reportsRouter.post('/daily-ciro', async (req, res) => {
  try {
    const secret = process.env.CRON_SECRET;
    const provided = req.header('x-cron-secret') || (req.query.secret as string | undefined);
    if (!secret || provided !== secret) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    // 1) Hedef gun (TR). Verilmezse "yeni biten gun" = bir onceki TR gunu
    //    (cron gece 00:30 TR'de calisir; o gunun TAM cirosunu raporlar).
    let targetDate = (req.query.date as string | undefined)?.trim();
    if (!targetDate) {
      const r: any = await db.execute(sql`SELECT ((now() AT TIME ZONE 'Europe/Istanbul')::date - 1)::text AS d`);
      targetDate = (Array.isArray(r) ? r[0]?.d : r.rows?.[0]?.d) as string;
    }

    // 2) Idempotency: bugun zaten basariyla gonderildiyse atla (force degilse)
    const force = req.query.force === '1' || req.query.force === 'true';
    if (!force) {
      const dup: any = await db.execute(sql`
        SELECT count(*)::int AS n FROM notification_logs
        WHERE event = 'daily_summary' AND status = 'sent'
          AND ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Istanbul')::date = ${targetDate}::date`);
      const n = (Array.isArray(dup) ? dup[0]?.n : dup.rows?.[0]?.n) ?? 0;
      if (n > 0) {
        return res.json({ skipped: true, reason: 'already_sent_today', date: targetDate });
      }
    }

    // 3) O gun (TR) kesilen irsaliyeler
    const wbRes: any = await db.execute(sql`
      SELECT w.tenant_id AS tenant_id, t.name AS hotel, w.item_summary AS item_summary, w.total_items AS total_items
      FROM waybills w JOIN tenants t ON t.id = w.tenant_id
      WHERE w.printed_at IS NOT NULL
        AND ((w.printed_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Istanbul')::date = ${targetDate}::date`);
    const waybillRows: any[] = Array.isArray(wbRes) ? wbRes : wbRes.rows ?? [];

    // 4) Fiyat haritasi: `${tenantId}|${urunAdi}` -> kurus
    const priceRes: any = await db.execute(sql`
      SELECT tp.tenant_id AS tenant_id, it.name AS name, tp.price AS price
      FROM tenant_pricing tp JOIN item_types it ON it.id = tp.item_type_id
      WHERE tp.price > 0`);
    const priceRows: any[] = Array.isArray(priceRes) ? priceRes : priceRes.rows ?? [];
    const priceMap = new Map<string, number>();
    for (const p of priceRows) priceMap.set(`${p.tenant_id}|${p.name}`, Number(p.price));

    // 5) Otel bazinda topla
    type Agg = { hotel: string; revenueKurus: number; waybills: number; items: number; hasUnpriced: boolean };
    const byHotel = new Map<string, Agg>();
    for (const w of waybillRows) {
      let agg = byHotel.get(w.tenant_id);
      if (!agg) { agg = { hotel: w.hotel, revenueKurus: 0, waybills: 0, items: 0, hasUnpriced: false }; byHotel.set(w.tenant_id, agg); }
      agg.waybills += 1;
      let lines: Array<{ typeName: string; count: number }> = [];
      try { lines = JSON.parse(w.item_summary || '[]'); } catch { lines = []; }
      for (const ln of lines) {
        const cnt = Number(ln.count) || 0;
        agg.items += cnt;
        const price = priceMap.get(`${w.tenant_id}|${ln.typeName}`);
        if (price == null) agg.hasUnpriced = true;
        else agg.revenueKurus += cnt * price;
      }
    }

    const aggs = Array.from(byHotel.values()).sort((a, b) => b.revenueKurus - a.revenueKurus);
    const totalKurus = aggs.reduce((s, a) => s + a.revenueKurus, 0);
    const totalWaybills = aggs.reduce((s, a) => s + a.waybills, 0);
    const totalItems = aggs.reduce((s, a) => s + a.items, 0);

    const fmtTL = (kurus: number) =>
      (kurus / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL';
    const fmtDate = (() => {
      const [y, m, d] = targetDate!.split('-');
      return `${d}.${m}.${y}`;
    })();

    // 6) Mesaj govdesi (otel kirilimi + fiyatsiz uyarisi)
    const priced = aggs.filter((a) => a.revenueKurus > 0);
    const unpriced = aggs.filter((a) => a.revenueKurus === 0);
    let breakdown = priced.length
      ? priced.map((a) => `• ${a.hotel}: ${fmtTL(a.revenueKurus)} (${a.waybills} irşaliye, ${a.items} ürün)`).join('\n')
      : '(fiyatı tanımlı otel cirosu yok)';
    if (unpriced.length) {
      breakdown += `\n\n⚠️ Fiyatı tanımlı olmayan oteller (ciroya 0 yazıldı):\n` +
        unpriced.map((a) => `• ${a.hotel} (${a.waybills} irşaliye, ${a.items} ürün)`).join('\n');
    }

    // 7) Alicilar
    const recipients = (process.env.DAILY_CIRO_RECIPIENTS || '+905323735583,+14257864847')
      .split(',').map((s) => s.trim()).filter(Boolean);

    // 8) Gonder
    const sendRes = await sendDailyCiroWhatsApp({
      toPhones: recipients,
      date: fmtDate,
      hotelBreakdown: breakdown,
      totalRevenue: fmtTL(totalKurus),
      waybillCount: totalWaybills,
      itemCount: totalItems,
    });

    return res.json({
      date: targetDate,
      totalRevenue: fmtTL(totalKurus),
      totalWaybills,
      totalItems,
      hotels: aggs.length,
      pricedHotels: priced.length,
      unpricedHotels: unpriced.map((a) => a.hotel),
      sent: sendRes.sent,
      recipients: sendRes.results,
    });
  } catch (error) {
    console.error('daily-ciro error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

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

