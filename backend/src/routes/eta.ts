/**
 * ETA V.8 SQL Entegrasyon API Endpoint'leri
 *
 * - GET  /api/eta/status        : Bağlantı durumu
 * - GET  /api/eta/tables        : ETA tablo listesi (keşif)
 * - GET  /api/eta/table/:name   : Tablo yapısı (keşif)
 * - GET  /api/eta/cariler       : ETA'daki cari kartları listele
 * - GET  /api/eta/stoklar       : ETA'daki stok kartlarını listele
 * - POST /api/eta/sync/cariler  : Carileri tenant'lara senkronla
 * - POST /api/eta/sync/stoklar  : Stokları itemType'lara senkronla
 * - POST /api/eta/sync/all      : Tüm verileri senkronla
 * - POST /api/eta/irsaliye      : Teslimatı ETA'ya irsaliye olarak gönder
 */

import { Router, Request, Response } from 'express';
import {
  testEtaConnection,
  listEtaTables,
  getTableColumns,
} from '../services/eta-connection';
import {
  getEtaCariKartlar,
  getEtaStokKartlar,
  syncCarileriTenantlara,
  syncStoklariItemTypelara,
  getTenantEtaKodu,
  getItemTypeEtaKodu,
  sendDeliveryToEta,
} from '../services/eta-sync';
import { db } from '../db';
import { deliveries, deliveryItems, items, itemTypes, tenants } from '../db/schema';
import { eq, inArray } from 'drizzle-orm';

const router = Router();

// ============================================
// BAĞLANTI VE KEŞİF
// ============================================

/**
 * ETA bağlantı durumunu kontrol eder
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const result = await testEtaConnection();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: `Bağlantı hatası: ${error.message}`,
    });
  }
});

/**
 * ETA'daki tüm tabloları listeler (keşif için)
 */
router.get('/tables', async (req: Request, res: Response) => {
  try {
    const tables = await listEtaTables();
    res.json({
      success: true,
      count: tables.length,
      tables,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: `Tablo listesi alınamadı: ${error.message}`,
    });
  }
});

/**
 * Belirli bir tablonun yapısını döndürür (keşif için)
 */
router.get('/table/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const columns = await getTableColumns(name);
    res.json({
      success: true,
      table: name,
      columnCount: columns.length,
      columns,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: `Tablo yapısı alınamadı: ${error.message}`,
    });
  }
});

// ============================================
// ETA VERİLERİNİ LİSTELEME
// ============================================

/**
 * ETA'daki cari kartları listeler
 */
router.get('/cariler', async (req: Request, res: Response) => {
  try {
    const cariler = await getEtaCariKartlar();
    res.json({
      success: true,
      count: cariler.length,
      data: cariler,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: `Cari kartlar alınamadı: ${error.message}`,
    });
  }
});

/**
 * ETA'daki stok kartlarını listeler
 */
router.get('/stoklar', async (req: Request, res: Response) => {
  try {
    const stoklar = await getEtaStokKartlar();
    res.json({
      success: true,
      count: stoklar.length,
      data: stoklar,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: `Stok kartları alınamadı: ${error.message}`,
    });
  }
});

// ============================================
// SENKRONİZASYON
// ============================================

/**
 * ETA cari kartlarını RFID tenant'larına senkronlar
 */
router.post('/sync/cariler', async (req: Request, res: Response) => {
  try {
    const result = await syncCarileriTenantlara();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: `Senkronizasyon hatası: ${error.message}`,
    });
  }
});

/**
 * ETA stok kartlarını RFID itemType'larına senkronlar
 */
router.post('/sync/stoklar', async (req: Request, res: Response) => {
  try {
    const result = await syncStoklariItemTypelara();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: `Senkronizasyon hatası: ${error.message}`,
    });
  }
});

/**
 * Tüm ETA verilerini senkronlar (cariler + stoklar)
 */
router.post('/sync/all', async (req: Request, res: Response) => {
  try {
    const cariResult = await syncCarileriTenantlara();
    const stokResult = await syncStoklariItemTypelara();

    res.json({
      success: cariResult.success && stokResult.success,
      cariler: cariResult,
      stoklar: stokResult,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: `Senkronizasyon hatası: ${error.message}`,
    });
  }
});

// ============================================
// İRSALİYE GÖNDERME
// ============================================

/**
 * Teslimatı ETA'ya satış irsaliyesi olarak gönderir
 *
 * Body: { deliveryId: string }
 */
router.post('/irsaliye', async (req: Request, res: Response) => {
  try {
    const { deliveryId } = req.body;

    if (!deliveryId) {
      return res.status(400).json({
        success: false,
        message: 'deliveryId gerekli',
      });
    }

    // Teslimatı bul
    const delivery = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId))
      .limit(1);

    if (delivery.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teslimat bulunamadı',
      });
    }

    // Tenant'ın ETA kodunu bul
    const tenantEtaKod = await getTenantEtaKodu(delivery[0].tenantId);
    if (!tenantEtaKod) {
      return res.status(400).json({
        success: false,
        message: 'Bu otelin ETA cari kodu tanımlı değil. Önce senkronizasyon yapın.',
      });
    }

    // Teslimat kalemlerini bul
    const deliveryItemsList = await db
      .select({
        itemId: deliveryItems.itemId,
      })
      .from(deliveryItems)
      .where(eq(deliveryItems.deliveryId, deliveryId));

    if (deliveryItemsList.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Teslimat kalemleri bulunamadı',
      });
    }

    // Item'ların itemType'larını bul
    const itemIds = deliveryItemsList.map((di) => di.itemId);
    const itemsList = await db
      .select({
        id: items.id,
        itemTypeId: items.itemTypeId,
      })
      .from(items)
      .where(inArray(items.id, itemIds));

    // Her item için ETA stok kodunu bul
    const irsaliyeItems: { itemTypeEtaKod: string; miktar: number }[] = [];
    const missingEtaCodes: string[] = [];

    for (const item of itemsList) {
      const etaKod = await getItemTypeEtaKodu(item.itemTypeId);
      if (etaKod) {
        irsaliyeItems.push({
          itemTypeEtaKod: etaKod,
          miktar: 1,
        });
      } else {
        // ETA kodu olmayan itemType
        const itemType = await db
          .select({ name: itemTypes.name })
          .from(itemTypes)
          .where(eq(itemTypes.id, item.itemTypeId))
          .limit(1);

        if (itemType[0]?.name && !missingEtaCodes.includes(itemType[0].name)) {
          missingEtaCodes.push(itemType[0].name);
        }
      }
    }

    if (irsaliyeItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Hiçbir ürünün ETA stok kodu tanımlı değil',
        missingEtaCodes,
      });
    }

    // ETA'ya irsaliye gönder
    const result = await sendDeliveryToEta(deliveryId, tenantEtaKod, irsaliyeItems);

    // Teslimatı güncelle (ETA fiş no'yu kaydet)
    if (result.success && result.etaFisNo) {
      await db
        .update(deliveries)
        .set({
          notes: `${delivery[0].notes || ''}\nETA İrsaliye: ${result.etaFisNo}`.trim(),
          updatedAt: new Date(),
        })
        .where(eq(deliveries.id, deliveryId));
    }

    res.json({
      ...result,
      itemCount: irsaliyeItems.length,
      missingEtaCodes: missingEtaCodes.length > 0 ? missingEtaCodes : undefined,
    });
  } catch (error: any) {
    console.error('ETA irsaliye gönderme hatası:', error);
    res.status(500).json({
      success: false,
      message: `İrsaliye gönderilemedi: ${error.message}`,
    });
  }
});

/**
 * Birden fazla teslimatı toplu olarak ETA'ya gönderir
 *
 * Body: { deliveryIds: string[] }
 */
router.post('/irsaliye/batch', async (req: Request, res: Response) => {
  try {
    const { deliveryIds } = req.body;

    if (!deliveryIds || !Array.isArray(deliveryIds) || deliveryIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'deliveryIds dizisi gerekli',
      });
    }

    const results: { deliveryId: string; success: boolean; etaFisNo?: string; message: string }[] = [];

    for (const deliveryId of deliveryIds) {
      try {
        // Her teslimat için yukarıdaki mantığı uygula (basitleştirilmiş)
        const delivery = await db
          .select()
          .from(deliveries)
          .where(eq(deliveries.id, deliveryId))
          .limit(1);

        if (delivery.length === 0) {
          results.push({ deliveryId, success: false, message: 'Teslimat bulunamadı' });
          continue;
        }

        const tenantEtaKod = await getTenantEtaKodu(delivery[0].tenantId);
        if (!tenantEtaKod) {
          results.push({ deliveryId, success: false, message: 'ETA cari kodu tanımlı değil' });
          continue;
        }

        const deliveryItemsList = await db
          .select({ itemId: deliveryItems.itemId })
          .from(deliveryItems)
          .where(eq(deliveryItems.deliveryId, deliveryId));

        const itemIds = deliveryItemsList.map((di) => di.itemId);
        const itemsList = await db
          .select({ itemTypeId: items.itemTypeId })
          .from(items)
          .where(inArray(items.id, itemIds));

        const irsaliyeItems: { itemTypeEtaKod: string; miktar: number }[] = [];
        for (const item of itemsList) {
          const etaKod = await getItemTypeEtaKodu(item.itemTypeId);
          if (etaKod) {
            irsaliyeItems.push({ itemTypeEtaKod: etaKod, miktar: 1 });
          }
        }

        if (irsaliyeItems.length === 0) {
          results.push({ deliveryId, success: false, message: 'ETA stok kodları eksik' });
          continue;
        }

        const result = await sendDeliveryToEta(deliveryId, tenantEtaKod, irsaliyeItems);
        results.push({
          deliveryId,
          success: result.success,
          etaFisNo: result.etaFisNo,
          message: result.message,
        });

        // Başarılıysa teslimatı güncelle
        if (result.success && result.etaFisNo) {
          await db
            .update(deliveries)
            .set({
              notes: `${delivery[0].notes || ''}\nETA İrsaliye: ${result.etaFisNo}`.trim(),
              updatedAt: new Date(),
            })
            .where(eq(deliveries.id, deliveryId));
        }
      } catch (err: any) {
        results.push({ deliveryId, success: false, message: err.message });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    res.json({
      success: successCount === deliveryIds.length,
      message: `${successCount}/${deliveryIds.length} irsaliye gönderildi`,
      results,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: `Toplu irsaliye gönderilemedi: ${error.message}`,
    });
  }
});

export default router;
