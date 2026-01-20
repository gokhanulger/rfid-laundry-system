/**
 * SQLite Database Module for RFID Laundry System
 * Uses sql.js (WebAssembly) for cross-platform compatibility
 * Provides offline-first data storage with sync capabilities
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let db = null;
let SQL = null;
let dbPath = null;
let saveTimer = null;
let isDirty = false;

// Initialize database
async function initDatabase() {
  if (db) return db;

  try {
    // Dynamic require for sql.js
    const initSqlJs = require('sql.js');

    // Initialize SQL.js with WebAssembly
    // Find the WASM file in node_modules
    const sqlWasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');

    SQL = await initSqlJs({
      locateFile: () => sqlWasmPath
    });

    // Store database in user data directory
    const userDataPath = app.getPath('userData');
    dbPath = path.join(userDataPath, 'rfid-cache.sqlite');

    console.log('[SQLite] Database path:', dbPath);

    // Load existing database or create new one
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
      console.log('[SQLite] Loaded existing database');
    } else {
      db = new SQL.Database();
      console.log('[SQLite] Created new database');
    }

    // Create tables
    createTables();

    // Auto-save every 5 seconds if dirty
    saveTimer = setInterval(() => {
      if (isDirty) {
        saveDatabase();
        isDirty = false;
      }
    }, 5000);

    console.log('[SQLite] Database initialized successfully');
    return db;
  } catch (error) {
    console.error('[SQLite] Failed to initialize database:', error);
    throw error;
  }
}

// Save database to disk
function saveDatabase() {
  if (!db || !dbPath) return;

  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
    console.log('[SQLite] Database saved to disk');
  } catch (error) {
    console.error('[SQLite] Failed to save database:', error);
  }
}

// Mark database as dirty (needs saving)
function markDirty() {
  isDirty = true;
}

// Create necessary tables
function createTables() {
  // Items table - cache of all RFID items
  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      rfid_tag TEXT NOT NULL UNIQUE,
      tenant_id TEXT NOT NULL,
      item_type_id TEXT NOT NULL,
      status TEXT NOT NULL,
      tenant_name TEXT,
      item_type_name TEXT,
      updated_at TEXT NOT NULL,
      synced_at TEXT NOT NULL
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_items_rfid ON items(rfid_tag)');
  db.run('CREATE INDEX IF NOT EXISTS idx_items_tenant ON items(tenant_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at)');

  // Tenants table - cache of hotels/tenants
  db.run(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      qr_code TEXT,
      updated_at TEXT NOT NULL
    )
  `);

  // Item types table
  db.run(`
    CREATE TABLE IF NOT EXISTS item_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    )
  `);

  // Pending operations queue - for offline actions
  db.run(`
    CREATE TABLE IF NOT EXISTS pending_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_type TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL,
      retry_count INTEGER DEFAULT 0,
      last_error TEXT
    )
  `);

  // Sync metadata
  db.run(`
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  markDirty();
  console.log('[SQLite] Tables created');
}

// ==========================================
// Item Operations
// ==========================================

// Get item by RFID tag (fast local lookup)
// Exact match only - DB stores same 24-char format as scanned EPC
function getItemByRfid(rfidTag) {
  if (!db) {
    console.log('[SQLite] Database not initialized!');
    return null;
  }

  const normalizedTag = rfidTag.toUpperCase();
  console.log('[SQLite] Looking up:', normalizedTag);

  // Try exact match
  let stmt = db.prepare(`
    SELECT i.*, t.name as tenant_name, it.name as item_type_name
    FROM items i
    LEFT JOIN tenants t ON i.tenant_id = t.id
    LEFT JOIN item_types it ON i.item_type_id = it.id
    WHERE UPPER(i.rfid_tag) = ?
  `);

  stmt.bind([normalizedTag]);

  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    console.log('[SQLite] Found:', row.rfid_tag);
    return row;
  }
  stmt.free();

  // Not found
  console.log('[SQLite] Not found:', normalizedTag);
  return null;
}

// Get all items count
function getItemsCount() {
  if (!db) return 0;
  const result = db.exec('SELECT COUNT(*) as count FROM items');
  return result.length > 0 && result[0].values.length > 0 ? result[0].values[0][0] : 0;
}

// Get sample RFIDs for debugging
function getSampleRfids(limit = 5) {
  if (!db) return [];
  const result = db.exec(`SELECT rfid_tag FROM items LIMIT ${limit}`);
  if (result.length === 0) return [];
  return result[0].values.map(row => row[0]);
}

// Bulk upsert items (for sync)
function upsertItems(items) {
  if (!db || !items || items.length === 0) return 0;

  const now = new Date().toISOString();
  let count = 0;
  let skippedNoRfid = 0;

  // Debug: Log first item to see field names
  if (items.length > 0) {
    console.log('[SQLite] First item keys:', Object.keys(items[0]));
    console.log('[SQLite] First item rfidTag:', items[0].rfidTag);
    console.log('[SQLite] First item rfid_tag:', items[0].rfid_tag);
  }

  // Use a transaction for better performance
  db.run('BEGIN TRANSACTION');

  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO items (id, rfid_tag, tenant_id, item_type_id, status, updated_at, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      // Try both camelCase and snake_case field names
      const rfidTag = item.rfidTag || item.rfid_tag;
      const tenantId = item.tenantId || item.tenant_id;
      const itemTypeId = item.itemTypeId || item.item_type_id;
      const updatedAt = item.updatedAt || item.updated_at;

      if (rfidTag) {
        stmt.run([
          item.id,
          rfidTag.toUpperCase(),
          tenantId,
          itemTypeId,
          item.status,
          updatedAt || now,
          now
        ]);
        count++;
      } else {
        skippedNoRfid++;
      }
    }

    if (skippedNoRfid > 0) {
      console.log('[SQLite] Skipped', skippedNoRfid, 'items without RFID tag');
    }

    stmt.free();
    db.run('COMMIT');
    markDirty();
  } catch (error) {
    db.run('ROLLBACK');
    console.error('[SQLite] Error upserting items:', error);
    throw error;
  }

  return count;
}

// Clear all items
function clearItems() {
  if (!db) return;
  db.run('DELETE FROM items');
  markDirty();
}

// ==========================================
// Tenant Operations
// ==========================================

function upsertTenants(tenants) {
  if (!db || !tenants || tenants.length === 0) return 0;

  const now = new Date().toISOString();
  let count = 0;

  db.run('BEGIN TRANSACTION');

  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO tenants (id, name, qr_code, updated_at)
      VALUES (?, ?, ?, ?)
    `);

    for (const tenant of tenants) {
      stmt.run([tenant.id, tenant.name, tenant.qrCode || null, now]);
      count++;
    }

    stmt.free();
    db.run('COMMIT');
    markDirty();
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }

  return count;
}

function getAllTenants() {
  if (!db) return [];
  const result = db.exec('SELECT * FROM tenants ORDER BY name');
  if (result.length === 0) return [];

  const columns = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

// ==========================================
// Item Type Operations
// ==========================================

function upsertItemTypes(itemTypes) {
  if (!db || !itemTypes || itemTypes.length === 0) return 0;

  let count = 0;

  db.run('BEGIN TRANSACTION');

  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO item_types (id, name, sort_order)
      VALUES (?, ?, ?)
    `);

    for (const type of itemTypes) {
      stmt.run([type.id, type.name, type.sortOrder || 0]);
      count++;
    }

    stmt.free();
    db.run('COMMIT');
    markDirty();
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }

  return count;
}

function getAllItemTypes() {
  if (!db) return [];
  const result = db.exec('SELECT * FROM item_types ORDER BY sort_order, name');
  if (result.length === 0) return [];

  const columns = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

// ==========================================
// Pending Operations (Offline Queue)
// ==========================================

function addPendingOperation(operationType, endpoint, method, payload) {
  if (!db) return null;

  db.run(`
    INSERT INTO pending_operations (operation_type, endpoint, method, payload, created_at)
    VALUES (?, ?, ?, ?, ?)
  `, [
    operationType,
    endpoint,
    method,
    JSON.stringify(payload),
    new Date().toISOString()
  ]);

  markDirty();

  // Get last inserted rowid
  const result = db.exec('SELECT last_insert_rowid()');
  return result.length > 0 ? result[0].values[0][0] : null;
}

function getPendingOperations() {
  if (!db) return [];
  const result = db.exec(`
    SELECT * FROM pending_operations
    ORDER BY created_at ASC
    LIMIT 100
  `);

  if (result.length === 0) return [];

  const columns = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    obj.payload = obj.payload ? JSON.parse(obj.payload) : null;
    return obj;
  });
}

function removePendingOperation(id) {
  if (!db) return;
  db.run('DELETE FROM pending_operations WHERE id = ?', [id]);
  markDirty();
}

function updatePendingOperationError(id, error) {
  if (!db) return;
  db.run(`
    UPDATE pending_operations
    SET retry_count = retry_count + 1, last_error = ?
    WHERE id = ?
  `, [error, id]);
  markDirty();
}

function getPendingOperationsCount() {
  if (!db) return 0;
  const result = db.exec('SELECT COUNT(*) as count FROM pending_operations');
  return result.length > 0 && result[0].values.length > 0 ? result[0].values[0][0] : 0;
}

// ==========================================
// Sync Metadata
// ==========================================

function getSyncMeta(key) {
  if (!db) return null;
  const stmt = db.prepare('SELECT value FROM sync_meta WHERE key = ?');
  stmt.bind([key]);

  if (stmt.step()) {
    const value = stmt.get()[0];
    stmt.free();
    return value;
  }

  stmt.free();
  return null;
}

function setSyncMeta(key, value) {
  if (!db) return;
  db.run(`
    INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)
  `, [key, value]);
  markDirty();
}

function getLastSyncTime() {
  return getSyncMeta('last_full_sync');
}

function setLastSyncTime(time) {
  setSyncMeta('last_full_sync', time || new Date().toISOString());
}

// ==========================================
// Database Stats
// ==========================================

function getDatabaseStats() {
  if (!db) return null;

  const itemsCount = getItemsCount();

  let tenantsCount = 0;
  let itemTypesCount = 0;

  try {
    const tenantsResult = db.exec('SELECT COUNT(*) FROM tenants');
    tenantsCount = tenantsResult.length > 0 ? tenantsResult[0].values[0][0] : 0;

    const typesResult = db.exec('SELECT COUNT(*) FROM item_types');
    itemTypesCount = typesResult.length > 0 ? typesResult[0].values[0][0] : 0;
  } catch (e) {
    console.error('[SQLite] Error getting stats:', e);
  }

  const pendingCount = getPendingOperationsCount();
  const lastSync = getLastSyncTime();

  return {
    itemsCount,
    tenantsCount,
    itemTypesCount,
    pendingOperationsCount: pendingCount,
    lastSyncTime: lastSync
  };
}

// Debug: Search items by partial RFID tag
function debugSearchItems(searchTerm) {
  if (!db) return { error: 'Database not initialized' };

  const term = searchTerm.toUpperCase();
  console.log('[SQLite DEBUG] Searching for:', term);

  // Count total items
  const totalResult = db.exec('SELECT COUNT(*) FROM items');
  const totalCount = totalResult.length > 0 ? totalResult[0].values[0][0] : 0;

  // Search for matching items
  const searchResult = db.exec(`
    SELECT rfid_tag, tenant_id, item_type_id, status
    FROM items
    WHERE UPPER(rfid_tag) LIKE '%${term}%'
    LIMIT 10
  `);

  const matches = [];
  if (searchResult.length > 0 && searchResult[0].values.length > 0) {
    for (const row of searchResult[0].values) {
      matches.push({
        rfid_tag: row[0],
        tenant_id: row[1],
        item_type_id: row[2],
        status: row[3]
      });
    }
  }

  // Get sample of all tags
  const sampleResult = db.exec('SELECT rfid_tag FROM items ORDER BY RANDOM() LIMIT 10');
  const samples = sampleResult.length > 0 ? sampleResult[0].values.map(r => r[0]) : [];

  return {
    totalItems: totalCount,
    searchTerm: term,
    matchCount: matches.length,
    matches,
    sampleTags: samples
  };
}

// Close database
function closeDatabase() {
  if (saveTimer) {
    clearInterval(saveTimer);
    saveTimer = null;
  }

  if (db) {
    // Final save before closing
    saveDatabase();
    db.close();
    db = null;
    console.log('[SQLite] Database closed');
  }
}

module.exports = {
  initDatabase,
  closeDatabase,
  saveDatabase,
  // Items
  getItemByRfid,
  getItemsCount,
  getSampleRfids,
  upsertItems,
  clearItems,
  // Tenants
  upsertTenants,
  getAllTenants,
  // Item Types
  upsertItemTypes,
  getAllItemTypes,
  // Pending Operations
  addPendingOperation,
  getPendingOperations,
  removePendingOperation,
  updatePendingOperationError,
  getPendingOperationsCount,
  // Sync
  getLastSyncTime,
  setLastSyncTime,
  getSyncMeta,
  setSyncMeta,
  // Stats
  getDatabaseStats,
  // Debug
  debugSearchItems
};
