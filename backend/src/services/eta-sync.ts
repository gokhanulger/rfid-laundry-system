/**
 * ETA V.8 SQL Senkronizasyon Servisi
 *
 * ETA Standart Tablo Yapısı (varsayılan):
 * - CAR_KART: Cari hesap kartları (müşteriler/oteller)
 * - STK_KART: Stok kartları (ürünler)
 * - IRS_FIS: İrsaliye fişleri (ana kayıt)
 * - IRS_STOK_HAREKET: İrsaliye detayları (satırlar)
 *
 * Not: Tablo ve alan isimleri ETA versiyonuna göre değişebilir.
 * Environment değişkenleri ile özelleştirilebilir.
 */

import sql from 'mssql';
import { getEtaPool } from './eta-connection';
import { db } from '../db';
import { tenants, itemTypes } from '../db/schema';
import { eq } from 'drizzle-orm';

// ETA tablo isimleri (environment'tan özelleştirilebilir)
const ETA_TABLES = {
  // Kart tabloları
  CARI_KART: process.env.ETA_TABLE_CARI || 'CarKart',
  STOK_KART: process.env.ETA_TABLE_STOK || 'StkKart',
  // İrsaliye tabloları
  IRS_FIS: process.env.ETA_TABLE_IRS_FIS || 'IrsFis',
  IRS_HAR: process.env.ETA_TABLE_IRS_HAR || 'IrsHar',
  // Cari hareket tabloları
  CAR_FIS: process.env.ETA_TABLE_CAR_FIS || 'CarFis',
  CAR_HAR: process.env.ETA_TABLE_CAR_HAR || 'CarHar',
  // Stok hareket tabloları
  STK_FIS: process.env.ETA_TABLE_STK_FIS || 'StkFis',
  STK_HAR: process.env.ETA_TABLE_STK_HAR || 'StkHar',
};

// ETA alan isimleri - ETA V.8 standart yapısı
const ETA_FIELDS = {
  // Cari kart alanları
  CARI_KOD: 'Kod',
  CARI_UNVAN: 'Unvan',
  CARI_ADRES: 'Adres',
  CARI_TEL: 'Telefon',
  CARI_EMAIL: 'Email',
  CARI_AKTIF: 'Aktif',

  // Stok kart alanları
  STOK_KOD: 'Kod',
  STOK_AD: 'Tanim',
  STOK_ACIKLAMA: 'Aciklama',
  STOK_BIRIM: 'Birim',
  STOK_AKTIF: 'Aktif',
};

// ============================================
// TİP TANIMLARI
// ============================================

export interface EtaCariKart {
  kod: string;
  unvan: string;
  adres?: string;
  telefon?: string;
  email?: string;
  aktif: boolean;
}

export interface EtaStokKart {
  kod: string;
  ad: string;
  aciklama?: string;
  birim?: string;
  aktif: boolean;
}

export interface EtaIrsaliyeSatir {
  stokKod: string;
  miktar: number;
  birim?: string;
  birimFiyat?: number;
}

export interface EtaIrsaliye {
  fisNo: string;
  tarih: Date;
  cariKod: string;
  tip: 'satis' | 'alis';
  aciklama?: string;
  satirlar: EtaIrsaliyeSatir[];
}

export interface SyncResult {
  success: boolean;
  message: string;
  imported?: number;
  updated?: number;
  errors?: string[];
}

// ============================================
// ETA'DAN VERİ ÇEKME
// ============================================

/**
 * ETA'dan tüm aktif cari kartları (otelleri) çeker
 */
export async function getEtaCariKartlar(): Promise<EtaCariKart[]> {
  const pool = await getEtaPool();

  const query = `
    SELECT
      ${ETA_FIELDS.CARI_KOD} as kod,
      ${ETA_FIELDS.CARI_UNVAN} as unvan,
      ${ETA_FIELDS.CARI_ADRES} as adres,
      ${ETA_FIELDS.CARI_TEL} as telefon,
      ${ETA_FIELDS.CARI_EMAIL} as email,
      ISNULL(${ETA_FIELDS.CARI_AKTIF}, 1) as aktif
    FROM ${ETA_TABLES.CARI_KART}
    WHERE ISNULL(${ETA_FIELDS.CARI_AKTIF}, 1) = 1
    ORDER BY ${ETA_FIELDS.CARI_UNVAN}
  `;

  try {
    const result = await pool.request().query(query);
    return result.recordset.map((row: any) => ({
      kod: row.kod?.trim(),
      unvan: row.unvan?.trim(),
      adres: row.adres?.trim(),
      telefon: row.telefon?.trim(),
      email: row.email?.trim(),
      aktif: row.aktif === 1 || row.aktif === true,
    }));
  } catch (error: any) {
    console.error('ETA cari kart çekme hatası:', error.message);
    throw error;
  }
}

/**
 * ETA'dan tüm aktif stok kartlarını (ürünleri) çeker
 */
export async function getEtaStokKartlar(): Promise<EtaStokKart[]> {
  const pool = await getEtaPool();

  const query = `
    SELECT
      ${ETA_FIELDS.STOK_KOD} as kod,
      ${ETA_FIELDS.STOK_AD} as ad,
      ${ETA_FIELDS.STOK_ACIKLAMA} as aciklama,
      ${ETA_FIELDS.STOK_BIRIM} as birim,
      ISNULL(${ETA_FIELDS.STOK_AKTIF}, 1) as aktif
    FROM ${ETA_TABLES.STOK_KART}
    WHERE ISNULL(${ETA_FIELDS.STOK_AKTIF}, 1) = 1
    ORDER BY ${ETA_FIELDS.STOK_AD}
  `;

  try {
    const result = await pool.request().query(query);
    return result.recordset.map((row: any) => ({
      kod: row.kod?.trim(),
      ad: row.ad?.trim(),
      aciklama: row.aciklama?.trim(),
      birim: row.birim?.trim(),
      aktif: row.aktif === 1 || row.aktif === true,
    }));
  } catch (error: any) {
    console.error('ETA stok kart çekme hatası:', error.message);
    throw error;
  }
}

// ============================================
// RFID UYGULAMASINA SENKRONLAMA
// ============================================

/**
 * ETA cari kartlarını RFID sistemine tenant olarak senkronlar
 * ETA kod'u qrCode alanına kaydedilir (eşleştirme için)
 */
export async function syncCarileriTenantlara(): Promise<SyncResult> {
  const errors: string[] = [];
  let imported = 0;
  let updated = 0;

  try {
    const etaCariler = await getEtaCariKartlar();

    for (const cari of etaCariler) {
      if (!cari.kod || !cari.unvan) {
        errors.push(`Geçersiz cari: kod veya ünvan eksik`);
        continue;
      }

      try {
        // Mevcut tenant'ı kontrol et (qrCode = ETA kodu)
        const existing = await db
          .select()
          .from(tenants)
          .where(eq(tenants.qrCode, cari.kod))
          .limit(1);

        if (existing.length > 0) {
          // Güncelle
          await db
            .update(tenants)
            .set({
              name: cari.unvan,
              address: cari.adres || existing[0].address,
              phone: cari.telefon || existing[0].phone,
              email: cari.email || existing[0].email,
              isActive: cari.aktif,
              updatedAt: new Date(),
            })
            .where(eq(tenants.id, existing[0].id));
          updated++;
        } else {
          // Yeni ekle
          await db.insert(tenants).values({
            name: cari.unvan,
            qrCode: cari.kod, // ETA kodu ile eşleştirme
            address: cari.adres,
            phone: cari.telefon,
            email: cari.email,
            isActive: cari.aktif,
          });
          imported++;
        }
      } catch (err: any) {
        errors.push(`${cari.unvan}: ${err.message}`);
      }
    }

    return {
      success: errors.length === 0,
      message: `Senkronizasyon tamamlandı: ${imported} yeni, ${updated} güncellendi`,
      imported,
      updated,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Senkronizasyon hatası: ${error.message}`,
      errors: [error.message],
    };
  }
}

/**
 * ETA stok kartlarını RFID sistemine itemType olarak senkronlar
 * Stok kodu description alanına kaydedilir (eşleştirme için)
 */
export async function syncStoklariItemTypelara(): Promise<SyncResult> {
  const errors: string[] = [];
  let imported = 0;
  let updated = 0;

  try {
    const etaStoklar = await getEtaStokKartlar();

    for (const stok of etaStoklar) {
      if (!stok.kod || !stok.ad) {
        errors.push(`Geçersiz stok: kod veya ad eksik`);
        continue;
      }

      try {
        // Mevcut itemType'ı kontrol et (description'da ETA kodu tutulur)
        const existing = await db
          .select()
          .from(itemTypes)
          .where(eq(itemTypes.description, `ETA:${stok.kod}`))
          .limit(1);

        if (existing.length > 0) {
          // Güncelle
          await db
            .update(itemTypes)
            .set({
              name: stok.ad,
            })
            .where(eq(itemTypes.id, existing[0].id));
          updated++;
        } else {
          // Yeni ekle
          await db.insert(itemTypes).values({
            name: stok.ad,
            description: `ETA:${stok.kod}`, // ETA kodu ile eşleştirme
          });
          imported++;
        }
      } catch (err: any) {
        errors.push(`${stok.ad}: ${err.message}`);
      }
    }

    return {
      success: errors.length === 0,
      message: `Senkronizasyon tamamlandı: ${imported} yeni, ${updated} güncellendi`,
      imported,
      updated,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Senkronizasyon hatası: ${error.message}`,
      errors: [error.message],
    };
  }
}

// ============================================
// ETA'YA İRSALİYE GÖNDERME
// ============================================

/**
 * Tenant'ın ETA cari kodunu bulur
 */
export async function getTenantEtaKodu(tenantId: string): Promise<string | null> {
  const tenant = await db
    .select({ qrCode: tenants.qrCode })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  return tenant[0]?.qrCode || null;
}

/**
 * ItemType'ın ETA stok kodunu bulur
 */
export async function getItemTypeEtaKodu(itemTypeId: string): Promise<string | null> {
  const itemType = await db
    .select({ description: itemTypes.description })
    .from(itemTypes)
    .where(eq(itemTypes.id, itemTypeId))
    .limit(1);

  const desc = itemType[0]?.description;
  if (desc && desc.startsWith('ETA:')) {
    return desc.replace('ETA:', '');
  }
  return null;
}

/**
 * ETA'da bağımsız RefNo üretir
 * Tüm tablolarda aynı RefNo kullanılır (IrsFis, IrsHar, CarFis, CarHar, StkFis, StkHar)
 */
async function getNextRefNo(pool: sql.ConnectionPool): Promise<number> {
  // IrsFis tablosundan en yüksek RefNo'yu bul
  const result = await pool.request().query(`
    SELECT ISNULL(MAX(RefNo), 0) + 1 as nextRefNo FROM ${ETA_TABLES.IRS_FIS}
  `);
  return result.recordset[0].nextRefNo;
}

/**
 * ETA'ya satış irsaliyesi oluşturur
 * Tüm ilgili tablolara kayıt atar: IrsFis, IrsHar, CarFis, CarHar, StkFis, StkHar
 */
export async function createEtaSatisIrsaliyesi(irsaliye: Omit<EtaIrsaliye, 'fisNo'>): Promise<{ success: boolean; fisNo?: string; refNo?: number; message: string }> {
  const pool = await getEtaPool();
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    // Bağımsız RefNo al
    const refNo = await getNextRefNo(pool);
    const fisNo = `RFID-${refNo}`;
    const tarih = irsaliye.tarih;
    const cariKod = irsaliye.cariKod;
    const aciklama = irsaliye.aciklama || `RFID Yıkama Teslimatı - ${new Date().toLocaleDateString('tr-TR')}`;

    // Toplam tutarı hesapla
    let toplamTutar = 0;
    for (const satir of irsaliye.satirlar) {
      toplamTutar += (satir.miktar * (satir.birimFiyat || 0));
    }

    // 1. IrsFis - İrsaliye Ana Fiş
    const irsFisRequest = new sql.Request(transaction);
    await irsFisRequest
      .input('refNo', sql.Int, refNo)
      .input('fisNo', sql.VarChar(50), fisNo)
      .input('tarih', sql.DateTime, tarih)
      .input('cariKod', sql.VarChar(50), cariKod)
      .input('tip', sql.SmallInt, 1) // 1 = Satış İrsaliyesi
      .input('aciklama', sql.VarChar(255), aciklama)
      .input('toplamTutar', sql.Decimal(18, 2), toplamTutar)
      .query(`
        INSERT INTO ${ETA_TABLES.IRS_FIS}
          (RefNo, FisNo, Tarih, CariKod, Tip, Aciklama, ToplamTutar)
        VALUES
          (@refNo, @fisNo, @tarih, @cariKod, @tip, @aciklama, @toplamTutar)
      `);

    // 2. IrsHar - İrsaliye Hareket Satırları
    let satirNo = 0;
    for (const satir of irsaliye.satirlar) {
      satirNo++;
      const satirTutar = satir.miktar * (satir.birimFiyat || 0);

      const irsHarRequest = new sql.Request(transaction);
      await irsHarRequest
        .input('refNo', sql.Int, refNo)
        .input('satirNo', sql.Int, satirNo)
        .input('stokKod', sql.VarChar(50), satir.stokKod)
        .input('miktar', sql.Decimal(18, 3), satir.miktar)
        .input('birim', sql.VarChar(20), satir.birim || 'ADET')
        .input('birimFiyat', sql.Decimal(18, 4), satir.birimFiyat || 0)
        .input('tutar', sql.Decimal(18, 2), satirTutar)
        .query(`
          INSERT INTO ${ETA_TABLES.IRS_HAR}
            (RefNo, SatirNo, StokKod, Miktar, Birim, BirimFiyat, Tutar)
          VALUES
            (@refNo, @satirNo, @stokKod, @miktar, @birim, @birimFiyat, @tutar)
        `);

      // 3. StkFis - Stok Fiş (her satır için)
      const stkFisRequest = new sql.Request(transaction);
      await stkFisRequest
        .input('refNo', sql.Int, refNo)
        .input('satirNo', sql.Int, satirNo)
        .input('tarih', sql.DateTime, tarih)
        .input('stokKod', sql.VarChar(50), satir.stokKod)
        .input('tip', sql.SmallInt, 2) // 2 = Çıkış (Satış)
        .input('miktar', sql.Decimal(18, 3), satir.miktar)
        .input('aciklama', sql.VarChar(255), `İrsaliye: ${fisNo}`)
        .query(`
          INSERT INTO ${ETA_TABLES.STK_FIS}
            (RefNo, SatirNo, Tarih, StokKod, Tip, Miktar, Aciklama)
          VALUES
            (@refNo, @satirNo, @tarih, @stokKod, @tip, @miktar, @aciklama)
        `);

      // 4. StkHar - Stok Hareket
      const stkHarRequest = new sql.Request(transaction);
      await stkHarRequest
        .input('refNo', sql.Int, refNo)
        .input('satirNo', sql.Int, satirNo)
        .input('tarih', sql.DateTime, tarih)
        .input('stokKod', sql.VarChar(50), satir.stokKod)
        .input('girisCikis', sql.SmallInt, -1) // -1 = Çıkış
        .input('miktar', sql.Decimal(18, 3), satir.miktar)
        .input('birimFiyat', sql.Decimal(18, 4), satir.birimFiyat || 0)
        .input('tutar', sql.Decimal(18, 2), satirTutar)
        .query(`
          INSERT INTO ${ETA_TABLES.STK_HAR}
            (RefNo, SatirNo, Tarih, StokKod, GirisCikis, Miktar, BirimFiyat, Tutar)
          VALUES
            (@refNo, @satirNo, @tarih, @stokKod, @girisCikis, @miktar, @birimFiyat, @tutar)
        `);
    }

    // 5. CarFis - Cari Fiş (Borç kaydı)
    const carFisRequest = new sql.Request(transaction);
    await carFisRequest
      .input('refNo', sql.Int, refNo)
      .input('tarih', sql.DateTime, tarih)
      .input('cariKod', sql.VarChar(50), cariKod)
      .input('tip', sql.SmallInt, 1) // 1 = Borç
      .input('tutar', sql.Decimal(18, 2), toplamTutar)
      .input('aciklama', sql.VarChar(255), `İrsaliye: ${fisNo}`)
      .query(`
        INSERT INTO ${ETA_TABLES.CAR_FIS}
          (RefNo, Tarih, CariKod, Tip, Tutar, Aciklama)
        VALUES
          (@refNo, @tarih, @cariKod, @tip, @tutar, @aciklama)
      `);

    // 6. CarHar - Cari Hareket
    const carHarRequest = new sql.Request(transaction);
    await carHarRequest
      .input('refNo', sql.Int, refNo)
      .input('tarih', sql.DateTime, tarih)
      .input('cariKod', sql.VarChar(50), cariKod)
      .input('borcAlacak', sql.SmallInt, 1) // 1 = Borç
      .input('tutar', sql.Decimal(18, 2), toplamTutar)
      .input('aciklama', sql.VarChar(255), `İrsaliye: ${fisNo}`)
      .query(`
        INSERT INTO ${ETA_TABLES.CAR_HAR}
          (RefNo, Tarih, CariKod, BorcAlacak, Tutar, Aciklama)
        VALUES
          (@refNo, @tarih, @cariKod, @borcAlacak, @tutar, @aciklama)
      `);

    await transaction.commit();

    console.log(`✓ ETA irsaliye oluşturuldu: RefNo=${refNo}, FisNo=${fisNo}`);
    return {
      success: true,
      fisNo,
      refNo,
      message: `İrsaliye başarıyla oluşturuldu: ${fisNo} (RefNo: ${refNo})`,
    };
  } catch (error: any) {
    await transaction.rollback();
    console.error('ETA irsaliye oluşturma hatası:', error);
    return {
      success: false,
      message: `İrsaliye oluşturulamadı: ${error.message}`,
    };
  }
}

/**
 * RFID teslimatını ETA'ya satış irsaliyesi olarak gönderir
 */
export async function sendDeliveryToEta(
  deliveryId: string,
  tenantEtaKod: string,
  items: { itemTypeEtaKod: string; miktar: number }[]
): Promise<{ success: boolean; etaFisNo?: string; message: string }> {
  // Aynı itemType'ları grupla ve miktarları topla
  const groupedItems = items.reduce((acc, item) => {
    if (acc[item.itemTypeEtaKod]) {
      acc[item.itemTypeEtaKod] += item.miktar;
    } else {
      acc[item.itemTypeEtaKod] = item.miktar;
    }
    return acc;
  }, {} as Record<string, number>);

  const satirlar: EtaIrsaliyeSatir[] = Object.entries(groupedItems).map(([stokKod, miktar]) => ({
    stokKod,
    miktar,
    birim: 'ADET',
    birimFiyat: 0, // Fiyat ETA'daki stok kartından alınabilir
  }));

  const result = await createEtaSatisIrsaliyesi({
    tarih: new Date(),
    cariKod: tenantEtaKod,
    tip: 'satis',
    aciklama: `RFID Teslimat ID: ${deliveryId}`,
    satirlar,
  });

  return {
    success: result.success,
    etaFisNo: result.fisNo,
    message: result.message,
  };
}
