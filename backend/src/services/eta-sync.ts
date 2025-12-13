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
  CARI_KART: process.env.ETA_TABLE_CARI || 'CAR_KART',
  STOK_KART: process.env.ETA_TABLE_STOK || 'STK_KART',
  IRSALIYE_FIS: process.env.ETA_TABLE_IRS_FIS || 'IRS_FIS',
  IRSALIYE_HAREKET: process.env.ETA_TABLE_IRS_HAREKET || 'IRS_STOK_HAREKET',
};

// ETA alan isimleri (environment'tan özelleştirilebilir)
const ETA_FIELDS = {
  // Cari kart alanları
  CARI_KOD: process.env.ETA_FIELD_CARI_KOD || 'CAR_KOD',
  CARI_UNVAN: process.env.ETA_FIELD_CARI_UNVAN || 'CAR_UNVAN',
  CARI_ADRES: process.env.ETA_FIELD_CARI_ADRES || 'CAR_ADRES',
  CARI_TEL: process.env.ETA_FIELD_CARI_TEL || 'CAR_TEL',
  CARI_EMAIL: process.env.ETA_FIELD_CARI_EMAIL || 'CAR_EMAIL',
  CARI_AKTIF: process.env.ETA_FIELD_CARI_AKTIF || 'CAR_AKTIF',

  // Stok kart alanları
  STOK_KOD: process.env.ETA_FIELD_STOK_KOD || 'STK_KOD',
  STOK_AD: process.env.ETA_FIELD_STOK_AD || 'STK_AD',
  STOK_ACIKLAMA: process.env.ETA_FIELD_STOK_ACIKLAMA || 'STK_ACIKLAMA',
  STOK_BIRIM: process.env.ETA_FIELD_STOK_BIRIM || 'STK_BIRIM',
  STOK_AKTIF: process.env.ETA_FIELD_STOK_AKTIF || 'STK_AKTIF',

  // İrsaliye fis alanları
  IRS_FISNO: process.env.ETA_FIELD_IRS_FISNO || 'IRS_FISNO',
  IRS_TARIH: process.env.ETA_FIELD_IRS_TARIH || 'IRS_TARIH',
  IRS_CARI_KOD: process.env.ETA_FIELD_IRS_CARI_KOD || 'IRS_CARI_KOD',
  IRS_TIP: process.env.ETA_FIELD_IRS_TIP || 'IRS_TIP', // 1: Satış, 2: Alış
  IRS_ACIKLAMA: process.env.ETA_FIELD_IRS_ACIKLAMA || 'IRS_ACIKLAMA',

  // İrsaliye hareket alanları
  IRSHR_FISNO: process.env.ETA_FIELD_IRSHR_FISNO || 'IRSHR_FISNO',
  IRSHR_STOK_KOD: process.env.ETA_FIELD_IRSHR_STOK_KOD || 'IRSHR_STOK_KOD',
  IRSHR_MIKTAR: process.env.ETA_FIELD_IRSHR_MIKTAR || 'IRSHR_MIKTAR',
  IRSHR_BIRIM: process.env.ETA_FIELD_IRSHR_BIRIM || 'IRSHR_BIRIM',
  IRSHR_BIRIM_FIYAT: process.env.ETA_FIELD_IRSHR_BIRIM_FIYAT || 'IRSHR_BIRIM_FIYAT',
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
 * ETA'da yeni irsaliye numarası üretir
 */
async function getNextIrsaliyeNo(): Promise<string> {
  const pool = await getEtaPool();

  // Yıl-ay bazlı numara: YYYYMM-XXXX
  const prefix = new Date().toISOString().slice(0, 7).replace('-', '');

  const result = await pool.request()
    .input('prefix', sql.VarChar, `${prefix}-%`)
    .query(`
      SELECT TOP 1 ${ETA_FIELDS.IRS_FISNO} as fisNo
      FROM ${ETA_TABLES.IRSALIYE_FIS}
      WHERE ${ETA_FIELDS.IRS_FISNO} LIKE @prefix
      ORDER BY ${ETA_FIELDS.IRS_FISNO} DESC
    `);

  if (result.recordset.length === 0) {
    return `${prefix}-0001`;
  }

  const lastNo = result.recordset[0].fisNo;
  const lastNum = parseInt(lastNo.split('-')[1] || '0', 10);
  return `${prefix}-${String(lastNum + 1).padStart(4, '0')}`;
}

/**
 * ETA'ya satış irsaliyesi oluşturur
 */
export async function createEtaSatisIrsaliyesi(irsaliye: Omit<EtaIrsaliye, 'fisNo'>): Promise<{ success: boolean; fisNo?: string; message: string }> {
  const pool = await getEtaPool();
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    // Yeni irsaliye numarası al
    const fisNo = await getNextIrsaliyeNo();

    // İrsaliye fişi oluştur
    const request = new sql.Request(transaction);
    await request
      .input('fisNo', sql.VarChar, fisNo)
      .input('tarih', sql.DateTime, irsaliye.tarih)
      .input('cariKod', sql.VarChar, irsaliye.cariKod)
      .input('tip', sql.Int, 1) // 1 = Satış irsaliyesi
      .input('aciklama', sql.VarChar, irsaliye.aciklama || `RFID Yıkama Teslimatı - ${new Date().toLocaleDateString('tr-TR')}`)
      .query(`
        INSERT INTO ${ETA_TABLES.IRSALIYE_FIS}
          (${ETA_FIELDS.IRS_FISNO}, ${ETA_FIELDS.IRS_TARIH}, ${ETA_FIELDS.IRS_CARI_KOD}, ${ETA_FIELDS.IRS_TIP}, ${ETA_FIELDS.IRS_ACIKLAMA})
        VALUES
          (@fisNo, @tarih, @cariKod, @tip, @aciklama)
      `);

    // İrsaliye satırlarını ekle
    for (const satir of irsaliye.satirlar) {
      const satırRequest = new sql.Request(transaction);
      await satırRequest
        .input('fisNo', sql.VarChar, fisNo)
        .input('stokKod', sql.VarChar, satir.stokKod)
        .input('miktar', sql.Decimal(18, 3), satir.miktar)
        .input('birim', sql.VarChar, satir.birim || 'ADET')
        .input('birimFiyat', sql.Decimal(18, 4), satir.birimFiyat || 0)
        .query(`
          INSERT INTO ${ETA_TABLES.IRSALIYE_HAREKET}
            (${ETA_FIELDS.IRSHR_FISNO}, ${ETA_FIELDS.IRSHR_STOK_KOD}, ${ETA_FIELDS.IRSHR_MIKTAR}, ${ETA_FIELDS.IRSHR_BIRIM}, ${ETA_FIELDS.IRSHR_BIRIM_FIYAT})
          VALUES
            (@fisNo, @stokKod, @miktar, @birim, @birimFiyat)
        `);
    }

    await transaction.commit();

    return {
      success: true,
      fisNo,
      message: `İrsaliye başarıyla oluşturuldu: ${fisNo}`,
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
