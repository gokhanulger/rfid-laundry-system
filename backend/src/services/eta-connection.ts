/**
 * ETA V.8 SQL Bağlantı Servisi
 * MSSQL üzerinden ETA veritabanına bağlantı sağlar
 */

import sql from 'mssql';

// ETA MSSQL bağlantı ayarları
export interface EtaConfig {
  server: string;      // ETA SQL Server IP adresi
  port: number;        // SQL Server portu (varsayılan 1433)
  database: string;    // ETA veritabanı adı
  user: string;        // SQL Server kullanıcı adı
  password: string;    // SQL Server şifresi
  options?: {
    encrypt?: boolean;
    trustServerCertificate?: boolean;
  };
}

// Singleton bağlantı havuzu
let etaPool: sql.ConnectionPool | null = null;

/**
 * ETA veritabanı bağlantı konfigürasyonunu environment'tan alır
 */
export function getEtaConfig(): EtaConfig {
  return {
    server: process.env.ETA_SQL_SERVER || 'localhost',
    port: parseInt(process.env.ETA_SQL_PORT || '1433'),
    database: process.env.ETA_SQL_DATABASE || 'ETA',
    user: process.env.ETA_SQL_USER || 'sa',
    password: process.env.ETA_SQL_PASSWORD || '',
    options: {
      encrypt: false, // Yerel ağda genellikle false
      trustServerCertificate: true, // Self-signed sertifikalar için
    },
  };
}

/**
 * ETA MSSQL bağlantı havuzu oluşturur veya mevcut olanı döndürür
 */
export async function getEtaPool(): Promise<sql.ConnectionPool> {
  if (etaPool && etaPool.connected) {
    return etaPool;
  }

  const config = getEtaConfig();

  try {
    etaPool = await new sql.ConnectionPool({
      server: config.server,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      options: config.options,
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    }).connect();

    console.log('✓ ETA SQL Server bağlantısı başarılı');
    return etaPool;
  } catch (error) {
    console.error('✗ ETA SQL Server bağlantı hatası:', error);
    throw error;
  }
}

/**
 * ETA bağlantısını kapatır
 */
export async function closeEtaPool(): Promise<void> {
  if (etaPool) {
    await etaPool.close();
    etaPool = null;
    console.log('ETA bağlantısı kapatıldı');
  }
}

/**
 * ETA bağlantı durumunu kontrol eder
 */
export async function testEtaConnection(): Promise<{ success: boolean; message: string; version?: string }> {
  try {
    const pool = await getEtaPool();
    const result = await pool.request().query('SELECT @@VERSION as version');

    return {
      success: true,
      message: 'ETA SQL Server bağlantısı başarılı',
      version: result.recordset[0]?.version,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `ETA bağlantı hatası: ${error.message}`,
    };
  }
}

/**
 * ETA'daki tabloları listeler (keşif için)
 */
export async function listEtaTables(): Promise<string[]> {
  const pool = await getEtaPool();
  const result = await pool.request().query(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_NAME
  `);

  return result.recordset.map((row: any) => row.TABLE_NAME);
}

/**
 * Belirli bir tablonun yapısını (kolonlarını) döndürür
 */
export async function getTableColumns(tableName: string): Promise<{ name: string; type: string; nullable: boolean }[]> {
  const pool = await getEtaPool();
  const result = await pool.request()
    .input('tableName', sql.VarChar, tableName)
    .query(`
      SELECT
        COLUMN_NAME as name,
        DATA_TYPE as type,
        CASE WHEN IS_NULLABLE = 'YES' THEN 1 ELSE 0 END as nullable
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @tableName
      ORDER BY ORDINAL_POSITION
    `);

  return result.recordset;
}
