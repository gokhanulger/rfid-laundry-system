/**
 * Sync Service for RFID Laundry System
 * Handles data synchronization between Railway API and local SQLite
 */

const https = require('https');
const http = require('http');
const db = require('./database.cjs');

// API Configuration
const API_BASE_URL = 'https://rfid-laundry-backend-production.up.railway.app/api';
const API_HOST = 'rfid-laundry-backend-production.up.railway.app';

let authToken = null;
let syncInProgress = false;
let syncInterval = null;
let onlineStatus = true;
let mainWindow = null;

// Set main window for sending events
function setMainWindow(window) {
  mainWindow = window;
}

// Set auth token
function setAuthToken(token) {
  authToken = token;
  console.log('[Sync] Auth token set');
}

// Get auth token
function getAuthToken() {
  return authToken;
}

// Send status to renderer
function sendSyncStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync-status', status);
  }
}

// HTTP request helper
function apiRequest(endpoint, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    if (!authToken) {
      reject(new Error('No auth token'));
      return;
    }

    // Build the full path correctly - endpoint should start with /
    const fullPath = '/api' + (endpoint.startsWith('/') ? endpoint : '/' + endpoint);
    console.log('[Sync] API Request:', method, fullPath);

    const options = {
      hostname: API_HOST,
      port: 443,
      path: fullPath,
      method: method,
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            onlineStatus = true;
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => {
      onlineStatus = false;
      reject(e);
    });

    req.on('timeout', () => {
      onlineStatus = false;
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

// Check if online
function isOnline() {
  return onlineStatus;
}

// ==========================================
// Full Sync - Download all data
// ==========================================

async function fullSync() {
  if (syncInProgress) {
    console.log('[Sync] Sync already in progress, skipping');
    return { success: false, reason: 'already_in_progress' };
  }

  syncInProgress = true;
  sendSyncStatus({ status: 'syncing', message: 'Tam senkronizasyon başlatılıyor...' });

  try {
    console.log('[Sync] Starting full sync...');

    // 1. Sync tenants
    sendSyncStatus({ status: 'syncing', message: 'Oteller yükleniyor...' });
    const tenants = await apiRequest('/settings/tenants');
    if (Array.isArray(tenants)) {
      const tenantCount = db.upsertTenants(tenants);
      console.log(`[Sync] Synced ${tenantCount} tenants`);
    }

    // 2. Sync item types
    sendSyncStatus({ status: 'syncing', message: 'Ürün türleri yükleniyor...' });
    const itemTypes = await apiRequest('/settings/item-types');
    if (Array.isArray(itemTypes)) {
      const typeCount = db.upsertItemTypes(itemTypes);
      console.log(`[Sync] Synced ${typeCount} item types`);
    }

    // 3. Sync all items (paginated)
    sendSyncStatus({ status: 'syncing', message: 'Ürünler yükleniyor...' });
    let page = 1;
    let totalItems = 0;
    const limit = 1000; // Backend now supports up to 1000 per page
    let hasMore = true;
    let totalPages = 1;

    while (hasMore) {
      sendSyncStatus({
        status: 'syncing',
        message: `Ürünler yükleniyor... (Sayfa ${page}/${totalPages})`,
        progress: { page, totalItems, totalPages }
      });

      const response = await apiRequest(`/items?page=${page}&limit=${limit}`);
      const items = response.data || [];

      // Get pagination info from response
      if (response.pagination) {
        totalPages = response.pagination.totalPages || 1;
        console.log(`[Sync] Pagination: page ${page}/${totalPages}, total items: ${response.pagination.total}`);
      }

      if (items.length > 0) {
        const count = db.upsertItems(items);
        totalItems += count;
        console.log(`[Sync] Page ${page}: synced ${count} items (total: ${totalItems})`);
      }

      // Use pagination info to determine if there are more pages
      hasMore = page < totalPages;
      page++;

      // Safety limit
      if (page > 500) {
        console.log('[Sync] Reached page limit, stopping');
        break;
      }
    }

    // Update last sync time
    db.setLastSyncTime(new Date().toISOString());

    const stats = db.getDatabaseStats();
    const sampleRfids = db.getSampleRfids(5);
    console.log('[Sync] Full sync completed:', stats);
    console.log('[Sync] Sample RFIDs in database:', sampleRfids);

    sendSyncStatus({
      status: 'completed',
      message: `Senkronizasyon tamamlandı (${totalItems} ürün)`,
      stats,
      sampleRfids
    });

    syncInProgress = false;
    return { success: true, itemsCount: totalItems, stats };

  } catch (error) {
    console.error('[Sync] Full sync error:', error);
    sendSyncStatus({
      status: 'error',
      message: `Senkronizasyon hatası: ${error.message}`,
      error: error.message
    });
    syncInProgress = false;
    return { success: false, error: error.message };
  }
}

// ==========================================
// Delta Sync - Only changed items since last sync
// ==========================================

async function deltaSync() {
  if (syncInProgress) {
    return { success: false, reason: 'already_in_progress' };
  }

  const lastSync = db.getLastSyncTime();
  if (!lastSync) {
    // No previous sync, do full sync
    console.log('[Sync] No previous sync found, doing full sync');
    return fullSync();
  }

  syncInProgress = true;
  sendSyncStatus({ status: 'syncing', message: 'Değişiklikler kontrol ediliyor...' });

  try {
    console.log('[Sync] Starting delta sync since', lastSync);

    // Use updatedSince parameter to get only changed items
    let page = 1;
    let totalItems = 0;
    const limit = 1000;
    let hasMore = true;

    while (hasMore) {
      const response = await apiRequest(`/items?page=${page}&limit=${limit}&updatedSince=${encodeURIComponent(lastSync)}`);
      const items = response.data || [];

      console.log(`[Sync] Delta page ${page}: found ${items.length} changed items`);

      if (items.length > 0) {
        const count = db.upsertItems(items);
        totalItems += count;
      }

      // Use pagination info
      const totalPages = response.pagination?.totalPages || 1;
      hasMore = page < totalPages;
      page++;

      // Safety limit
      if (page > 100) break;
    }

    const newSyncTime = new Date().toISOString();
    db.setLastSyncTime(newSyncTime);

    const stats = db.getDatabaseStats();
    console.log(`[Sync] Delta sync completed: ${totalItems} items updated, total in DB: ${stats.itemsCount}`);

    sendSyncStatus({
      status: 'completed',
      message: totalItems > 0 ? `${totalItems} yeni/değişen ürün senkronize edildi` : 'Değişiklik yok',
      stats
    });

    syncInProgress = false;
    return { success: true, itemsCount: totalItems, stats };

  } catch (error) {
    console.error('[Sync] Delta sync error:', error);
    sendSyncStatus({ status: 'error', message: error.message });
    syncInProgress = false;
    return { success: false, error: error.message };
  }
}

// ==========================================
// Process Pending Operations (Offline Queue)
// ==========================================

async function processPendingOperations() {
  const pending = db.getPendingOperations();

  if (pending.length === 0) {
    return { processed: 0 };
  }

  console.log(`[Sync] Processing ${pending.length} pending operations`);
  let processed = 0;
  let failed = 0;

  for (const op of pending) {
    try {
      await apiRequest(op.endpoint, op.method, op.payload);
      db.removePendingOperation(op.id);
      processed++;
      console.log(`[Sync] Processed pending operation ${op.id}: ${op.operation_type}`);
    } catch (error) {
      console.error(`[Sync] Failed to process operation ${op.id}:`, error.message);
      db.updatePendingOperationError(op.id, error.message);
      failed++;

      // Stop processing if we're offline
      if (!onlineStatus) {
        console.log('[Sync] Offline, stopping pending operations processing');
        break;
      }
    }
  }

  return { processed, failed, remaining: pending.length - processed };
}

// ==========================================
// Add Operation to Queue
// ==========================================

function queueOperation(operationType, endpoint, method, payload) {
  const id = db.addPendingOperation(operationType, endpoint, method, payload);
  console.log(`[Sync] Queued operation ${id}: ${operationType}`);

  // Try to process immediately if online
  if (onlineStatus) {
    setTimeout(() => processPendingOperations(), 100);
  }

  return id;
}

// ==========================================
// Mark Items Clean (with offline support)
// ==========================================

async function markItemsClean(itemIds) {
  const payload = { itemIds };

  if (onlineStatus) {
    try {
      const result = await apiRequest('/items/mark-clean', 'POST', payload);
      // Update local database
      // Note: In a full implementation, you'd update the local status too
      return { success: true, online: true, result };
    } catch (error) {
      // Queue for later if request fails
      queueOperation('mark_clean', '/items/mark-clean', 'POST', payload);
      return { success: true, online: false, queued: true };
    }
  } else {
    // Offline - queue the operation
    queueOperation('mark_clean', '/items/mark-clean', 'POST', payload);
    return { success: true, online: false, queued: true };
  }
}

// ==========================================
// Auto Sync (Disabled - Manual sync only)
// ==========================================

function startAutoSync(intervalMs = 5 * 60 * 1000) {
  // Auto-sync disabled - sync is triggered manually or on login
  console.log('[Sync] Auto-sync disabled. Use manual sync button.');
}

function stopAutoSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('[Sync] Auto sync stopped');
  }
}

// ==========================================
// Initialize Sync Service
// ==========================================

async function initialize(token) {
  if (token) {
    setAuthToken(token);
  }

  // Initialize database
  await db.initDatabase();

  const stats = db.getDatabaseStats();
  console.log('[Sync] Database stats:', stats);

  // If no items, do full sync
  if (stats.itemsCount === 0 && authToken) {
    console.log('[Sync] No cached items, starting full sync...');
    await fullSync();
  }

  // Auto-sync disabled - use manual sync button
  // startAutoSync();

  return stats;
}

module.exports = {
  initialize,
  setMainWindow,
  setAuthToken,
  getAuthToken,
  isOnline,
  fullSync,
  deltaSync,
  processPendingOperations,
  queueOperation,
  markItemsClean,
  startAutoSync,
  stopAutoSync
};
