/**
 * Sync Service for RFID Laundry System
 * Handles data synchronization between Railway API and local SQLite
 */

const https = require('https');
const http = require('http');
const db = require('./database.cjs');
const lanSync = require('./lan-sync.cjs');

// API Configuration - Use Cloudflare Worker proxy to bypass corporate firewalls
const API_BASE_URL = 'https://rfid-api-proxy.mooogco.workers.dev/api';
const API_HOST = 'rfid-api-proxy.mooogco.workers.dev';

let authToken = null;
let syncInProgress = false;
let syncInterval = null;
let onlineStatus = true;
let consecutiveFailures = 0; // Track consecutive network failures
const OFFLINE_THRESHOLD = 2; // Go offline after 2 consecutive failures
let mainWindow = null;

// Track recently cancelled/packaged delivery IDs to prevent sync from overwriting
// Maps delivery ID -> timestamp when the operation was performed
const recentLocalOps = new Map();
const RECENT_OPS_TTL = 5 * 60 * 1000; // 5 minutes protection window

function addRecentLocalOp(deliveryId) {
  recentLocalOps.set(deliveryId, Date.now());
}

function cleanRecentLocalOps() {
  const now = Date.now();
  for (const [id, ts] of recentLocalOps) {
    if (now - ts > RECENT_OPS_TTL) recentLocalOps.delete(id);
  }
}

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

// Notify renderer that deliveries changed - triggers React Query refresh
function notifyDeliveriesChanged(source) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    console.log(`[Sync] Notifying renderer: deliveries changed (source: ${source})`);
    mainWindow.webContents.send('deliveries-changed', { source, timestamp: Date.now() });
  }
}

// HTTP request helper
function apiRequest(endpoint, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    if (!authToken) {
      console.error('[Sync] No auth token available!');
      reject(new Error('No auth token - please login again'));
      return;
    }

    // Build the full path correctly - endpoint should start with /
    const fullPath = '/api' + (endpoint.startsWith('/') ? endpoint : '/' + endpoint);
    console.log('[Sync] API Request:', method, fullPath, 'Token:', authToken ? authToken.substring(0, 20) + '...' : 'NONE');

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
          // Any HTTP response means network is working
          onlineStatus = true;
          consecutiveFailures = 0;
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            console.error('[Sync] API Error:', res.statusCode, data.substring(0, 200));
            const err = new Error(`HTTP ${res.statusCode}: ${data.substring(0, 100)}`);
            err.statusCode = res.statusCode; // kuyruk: kalici 4xx'te op'u dusurmek icin
            reject(err);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => {
      consecutiveFailures++;
      if (consecutiveFailures >= OFFLINE_THRESHOLD) {
        onlineStatus = false;
      }
      reject(e);
    });

    req.on('timeout', () => {
      consecutiveFailures++;
      if (consecutiveFailures >= OFFLINE_THRESHOLD) {
        onlineStatus = false;
      }
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

// Backend'de artik aktif (label_printed/packaged) olmayan yerel teslimatlari temizler.
// Boylece teslim edilmis / iptal edilmis / baska cihazda paketlenmis eski kayitlar
// paket ekraninda birikmez. SADECE iki durum da backend'den BASARIYLA cekildiyse cagrilmali.
// backendActiveIds: backend'in dondurdugu tum aktif teslimat ID'leri (protected filtresinden once)
// protectedIds: bekleyen/yeni yerel islemi olan ve dokunulmamasi gereken ID'ler
function reconcileLocalDeliveries(backendActiveIds, protectedIds) {
  let removed = 0;
  const localActive = [
    ...db.getDeliveriesByStatus('label_printed'),
    ...db.getDeliveriesByStatus('packaged'),
  ];
  for (const d of localActive) {
    if (!backendActiveIds.has(d.id) && !(protectedIds && protectedIds.has(d.id))) {
      db.deleteDelivery(d.id);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`[Sync] Reconcile: ${removed} bayat yerel teslimat silindi (backend'de aktif degil)`);
  }
  return removed;
}

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
        // Debug: Log first item structure to see field names
        if (page === 1 && items.length > 0) {
          console.log('[Sync] Sample item from API:', JSON.stringify(items[0], null, 2));
          console.log('[Sync] Item keys:', Object.keys(items[0]));
          console.log('[Sync] rfidTag value:', items[0].rfidTag);
        }
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

    // 4. Sync active deliveries (label_printed + packaged)
    sendSyncStatus({ status: 'syncing', message: 'Teslimatlar yükleniyor...' });
    let totalDeliveries = 0;

    // Protect locally modified deliveries from being overwritten
    const fullSyncPendingOps = db.getPendingOperations();
    const fullSyncProtectedIds = new Set();
    for (const op of fullSyncPendingOps) {
      if (op.operation_type === 'cancel_delivery' || op.operation_type === 'package_delivery') {
        const match = op.endpoint.match(/\/deliveries\/([^/]+)\//);
        if (match) fullSyncProtectedIds.add(match[1]);
      }
    }
    cleanRecentLocalOps();
    for (const id of recentLocalOps.keys()) {
      fullSyncProtectedIds.add(id);
    }

    const fullSyncBackendActiveIds = new Set();
    let fullSyncFetchOk = true;
    for (const deliveryStatus of ['label_printed', 'packaged']) {
      try {
        const response = await apiRequest(`/deliveries?status=${deliveryStatus}&limit=10000`);
        const all = response.data || [];
        // Gercek backend aktif seti (protected filtresinden ONCE) - reconcile icin
        all.forEach(d => fullSyncBackendActiveIds.add(d.id));
        let deliveries = all;
        if (fullSyncProtectedIds.size > 0) {
          deliveries = deliveries.filter(d => !fullSyncProtectedIds.has(d.id));
        }
        if (deliveries.length > 0) {
          const count = db.upsertDeliveries(deliveries);
          totalDeliveries += count;
          console.log(`[Sync] Synced ${count} deliveries with status ${deliveryStatus}`);
        }
      } catch (e) {
        fullSyncFetchOk = false; // bu durum cekilemedi -> reconcile guvenli degil
        console.log(`[Sync] Warning: Could not sync ${deliveryStatus} deliveries:`, e.message);
      }
    }
    // Iki durum da basariyla cekildiyse bayat yerel kayitlari temizle
    if (fullSyncFetchOk) {
      reconcileLocalDeliveries(fullSyncBackendActiveIds, fullSyncProtectedIds);
    }

    // Update last sync time
    db.setLastSyncTime(new Date().toISOString());

    const stats = db.getDatabaseStats();
    const sampleRfids = db.getSampleRfids(5);
    console.log('[Sync] Full sync completed:', stats);
    console.log('[Sync] Sample RFIDs in database:', sampleRfids);

    sendSyncStatus({
      status: 'completed',
      message: `Senkronizasyon tamamlandı (${totalItems} ürün, ${totalDeliveries} teslimat)`,
      stats,
      sampleRfids
    });

    // Notify renderer about delivery changes
    notifyDeliveriesChanged('full-sync');

    syncInProgress = false;
    return { success: true, itemsCount: totalItems, deliveriesCount: totalDeliveries, stats };

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

// Bu kadar denemeden sonra op kalici olarak dusurulur (sonsuz retry firtinasini onler)
const MAX_OP_RETRIES = 8;
// Tekrar denense de asla basarmayacak client hatalari -> op'u hemen dusur
const PERMANENT_4XX = new Set([400, 403, 404, 409, 410, 422]);

async function processPendingOperations() {
  const pending = db.getPendingOperations();

  if (pending.length === 0) {
    return { processed: 0 };
  }

  console.log(`[Sync] Processing ${pending.length} pending operations`);
  let processed = 0;
  let failed = 0;
  let dropped = 0;

  for (const op of pending) {
    // Bozuk eski op'lari (eksik /deliveries/ onekli paket/iptal endpoint'leri) gonderme, dusur.
    // Bunlar backend'de 400 doner ve sonsuza dek tekrar denenirdi (retry firtinasinin bir kaynagi).
    if ((op.operation_type === 'package_delivery' || op.operation_type === 'cancel_delivery')
        && typeof op.endpoint === 'string' && !op.endpoint.startsWith('/deliveries/')) {
      db.removePendingOperation(op.id);
      dropped++;
      console.warn(`[Sync] Dropped malformed pending op ${op.id} (${op.operation_type}): ${op.endpoint}`);
      continue;
    }

    try {
      await apiRequest(op.endpoint, op.method, op.payload);
      db.removePendingOperation(op.id);
      processed++;
      console.log(`[Sync] Processed pending operation ${op.id}: ${op.operation_type}`);
    } catch (error) {
      const status = error.statusCode;

      // 429 = rate limit (gecici). Dovmeyi birak: bu cycle'i durdur, op kalsin, sonra denenir.
      if (status === 429) {
        console.log('[Sync] Rate limited (429) - backing off, stopping queue this cycle');
        break;
      }

      // Kalici client hatasi (400/403/404...) -> tekrar denese de asla basarmaz, dusur.
      if (status && PERMANENT_4XX.has(status)) {
        db.removePendingOperation(op.id);
        dropped++;
        console.warn(`[Sync] Dropped pending op ${op.id} (${op.operation_type}) - kalici HTTP ${status}: ${error.message}`);
        continue;
      }

      // Diger hatalar (ag / 5xx / 401): retry sayacini artir, esigi gecince dusur.
      db.updatePendingOperationError(op.id, error.message);
      failed++;
      const retries = (op.retry_count || 0) + 1;
      if (retries >= MAX_OP_RETRIES) {
        db.removePendingOperation(op.id);
        dropped++;
        console.warn(`[Sync] Dropped pending op ${op.id} (${op.operation_type}) - ${retries} deneme sonrasi: ${error.message}`);
        continue;
      }
      console.error(`[Sync] Failed to process operation ${op.id} (retry ${retries}/${MAX_OP_RETRIES}):`, error.message);

      // Cevrimdisiysak isleme devam etme
      if (!onlineStatus) {
        console.log('[Sync] Offline, stopping pending operations processing');
        break;
      }
    }
  }

  if (dropped > 0) {
    console.log(`[Sync] Pending ops: ${processed} islendi, ${dropped} dusuruldu (kalici/bozuk/eski), ${failed} retry`);
  }

  return { processed, failed, dropped, remaining: db.getPendingOperationsCount() };
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
// Delivery Operations (with offline support)
// ==========================================

async function packageDelivery(deliveryId) {
  const now = new Date().toISOString();
  // Update local DB immediately
  db.updateDeliveryStatus(deliveryId, 'packaged', { packagedAt: now });
  // Protect from sync overwriting for 30 seconds
  addRecentLocalOp(deliveryId);

  // Notify renderer immediately
  notifyDeliveriesChanged('package');

  // Get the full delivery data to broadcast to LAN peers
  try {
    const delivery = db.getDeliveryById ? db.getDeliveryById(deliveryId) : null;
    if (delivery) {
      lanSync.broadcastDeliveryUpdate({
        ...delivery,
        status: 'packaged',
        packaged_at: now,
        updated_at: now
      });
    } else {
      lanSync.broadcastDeliveryUpdate({
        id: deliveryId,
        status: 'packaged',
        packaged_at: now,
        updated_at: now
      });
    }
  } catch (e) {
    console.log('[Sync] LAN broadcast error (non-critical):', e.message);
  }

  if (onlineStatus) {
    try {
      const result = await apiRequest(`/deliveries/${deliveryId}/package`, 'POST');
      return { success: true, online: true, result };
    } catch (error) {
      queueOperation('package_delivery', `/deliveries/${deliveryId}/package`, 'POST', {});
      return { success: true, online: false, queued: true };
    }
  } else {
    queueOperation('package_delivery', `/deliveries/${deliveryId}/package`, 'POST', {});
    return { success: true, online: false, queued: true };
  }
}

async function cancelDelivery(deliveryId) {
  const now = new Date().toISOString();
  // Delete from local DB immediately (not just status change)
  db.deleteDelivery(deliveryId);
  // Protect from sync re-inserting for 5 minutes
  addRecentLocalOp(deliveryId);
  console.log(`[Sync] Delivery ${deliveryId} deleted locally, protected from sync for 5 min`);

  // Notify renderer immediately
  notifyDeliveriesChanged('cancel');

  // Broadcast to LAN peers
  try {
    lanSync.broadcastDeliveryUpdate({ id: deliveryId, status: 'cancelled', updated_at: now });
  } catch (e) { /* non-critical */ }

  if (onlineStatus) {
    try {
      const result = await apiRequest(`/deliveries/${deliveryId}/cancel`, 'POST');
      return { success: true, online: true, result };
    } catch (error) {
      queueOperation('cancel_delivery', `/deliveries/${deliveryId}/cancel`, 'POST', {});
      return { success: true, online: false, queued: true };
    }
  } else {
    queueOperation('cancel_delivery', `/deliveries/${deliveryId}/cancel`, 'POST', {});
    return { success: true, online: false, queued: true };
  }
}

async function createWaybill(deliveryIds, bagCount, notes) {
  const payload = { deliveryIds, bagCount, notes };

  // Yerel durumu hemen guncelle (online da olsa offline da olsa) ki teslimatlar
  // 'packaged' listesinden cikip ekrandan gitsin. Online basarisiz olursa kuyruga alinir.
  // recentLocalOps'a ekle: backend waybill'i isleyene kadar bir sync bunlari
  // tekrar 'packaged' olarak EKLEMESIN (irsaliyesi kesilmis paketler geri gelmesin).
  for (const id of deliveryIds) {
    db.updateDeliveryStatus(id, 'waybill_created');
    addRecentLocalOp(id);
  }

  if (onlineStatus) {
    try {
      const result = await apiRequest('/waybills', 'POST', payload);
      return { success: true, online: true, result };
    } catch (error) {
      queueOperation('create_waybill', '/waybills', 'POST', payload);
      return { success: true, online: false, queued: true };
    }
  } else {
    queueOperation('create_waybill', '/waybills', 'POST', payload);
    return { success: true, online: false, queued: true };
  }
}

// Quick delivery sync - only syncs active deliveries (fast, for polling replacement)
// This runs independently of fullSync - no syncInProgress check
async function syncDeliveries(source = 'manual') {
  if (!authToken) {
    return { success: false, reason: 'no_token' };
  }

  try {
    let totalDeliveries = 0;

    // Snapshot local state BEFORE sync (just count IDs per status)
    const localLabelPrinted = new Set(db.getDeliveriesByStatus('label_printed').map(d => d.id));
    const localPackaged = new Set(db.getDeliveriesByStatus('packaged').map(d => d.id));

    // Get pending cancel/package operations to avoid overwriting local state
    const pendingOps = db.getPendingOperations();
    const protectedIds = new Set();
    for (const op of pendingOps) {
      if (op.operation_type === 'cancel_delivery' || op.operation_type === 'package_delivery') {
        // Extract delivery ID from endpoint like /deliveries/{id}/cancel
        const match = op.endpoint.match(/\/deliveries\/([^/]+)\//);
        if (match) protectedIds.add(match[1]);
      }
    }
    // Also protect recently cancelled/packaged deliveries (even if queue already processed)
    cleanRecentLocalOps();
    for (const id of recentLocalOps.keys()) {
      protectedIds.add(id);
    }

    if (protectedIds.size > 0) {
      console.log(`[Sync] Protecting ${protectedIds.size} deliveries from sync overwrite`);
    }

    const backendActiveIds = new Set();
    for (const status of ['label_printed', 'packaged']) {
      const response = await apiRequest(`/deliveries?status=${status}&limit=10000`);
      let deliveries = response.data || [];
      console.log(`[Sync] API returned ${deliveries.length} deliveries with status ${status}`);
      // Gercek backend aktif seti (protected filtresinden ONCE) - reconcile icin
      deliveries.forEach(d => backendActiveIds.add(d.id));
      // Skip deliveries that have pending local operations (cancel/package)
      // to avoid overwriting local state before server processes the operation
      if (protectedIds.size > 0) {
        const before = deliveries.length;
        deliveries = deliveries.filter(d => !protectedIds.has(d.id));
        if (before !== deliveries.length) {
          console.log(`[Sync] Filtered ${before - deliveries.length} protected deliveries`);
        }
      }
      if (deliveries.length > 0) {
        totalDeliveries += db.upsertDeliveries(deliveries);
      }
    }

    // Reconcile: backend'de artik label_printed/packaged olmayan (teslim edilmis / iptal /
    // baska cihazda paketlenmis) bayat yerel kayitlari sil. Iki durum da basariyla cekildi
    // (apiRequest hata firlatsaydi catch'e duserdik), bu yuzden guvenli.
    reconcileLocalDeliveries(backendActiveIds, protectedIds);

    // Snapshot local state AFTER sync
    const afterLabelPrinted = new Set(db.getDeliveriesByStatus('label_printed').map(d => d.id));
    const afterPackaged = new Set(db.getDeliveriesByStatus('packaged').map(d => d.id));

    // Simple change detection: did the ID sets change?
    const changed = localLabelPrinted.size !== afterLabelPrinted.size ||
                    localPackaged.size !== afterPackaged.size ||
                    [...afterLabelPrinted].some(id => !localLabelPrinted.has(id)) ||
                    [...afterPackaged].some(id => !localPackaged.has(id)) ||
                    [...localLabelPrinted].some(id => !afterLabelPrinted.has(id)) ||
                    [...localPackaged].some(id => !afterPackaged.has(id));

    if (changed) {
      console.log(`[Sync] Deliveries CHANGED! Before: ${localLabelPrinted.size}+${localPackaged.size}, After: ${afterLabelPrinted.size}+${afterPackaged.size}`);
    }

    // Always notify renderer - cost is minimal (just re-reads SQLite)
    notifyDeliveriesChanged(source);

    return { success: true, count: totalDeliveries, changed };
  } catch (error) {
    console.log(`[Sync] syncDeliveries error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ==========================================
// Auto Sync - Periodic sync to keep all users in sync
// ==========================================

function startAutoSync(intervalMs = 5 * 1000) {
  if (syncInterval) {
    clearInterval(syncInterval);
  }

  console.log(`[Sync] Auto-sync started (every ${intervalMs / 1000}s)`);

  // Run first sync immediately after 2 seconds
  setTimeout(() => {
    if (authToken) {
      console.log('[Sync] Running initial auto-sync...');
      runAutoSync();
    }
  }, 2000);

  syncInterval = setInterval(() => {
    if (authToken) runAutoSync();
  }, intervalMs);
}

let autoSyncRunning = false;

async function runAutoSync() {
  if (autoSyncRunning) return; // Prevent overlapping auto-syncs
  autoSyncRunning = true;

  try {
    // 1. Process pending operations first (offline queue)
    try {
      const pendingResult = await processPendingOperations();
      if (pendingResult.processed > 0) {
        console.log(`[Sync] Auto-sync: processed ${pendingResult.processed} pending ops`);
      }
    } catch (e) {
      // ignore
    }

    // 2. Sync deliveries from API
    const result = await syncDeliveries('auto-sync');
    if (result.success && result.changed) {
      console.log(`[Sync] Auto-sync: deliveries CHANGED (${result.count} total)`);
    }

    // Log failures for debugging
    if (!result.success && result.error) {
      console.log(`[Sync] Auto-sync failed: ${result.error}`);
    }
  } catch (e) {
    console.log('[Sync] Auto-sync error:', e.message);
  } finally {
    autoSyncRunning = false;
  }
}

function stopAutoSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('[Sync] Auto sync stopped');
  }
}

// Lightweight online check - tries a fast API call
async function checkOnlineStatus() {
  if (!authToken) return;

  const wasPreviouslyOnline = onlineStatus;
  try {
    // Use tenants endpoint as a lightweight ping (small payload)
    await apiRequest('/settings/tenants');
    // apiRequest already sets onlineStatus = true on success
    if (!wasPreviouslyOnline && onlineStatus) {
      console.log('[Sync] Back online!');
      sendSyncStatus({ status: 'online', message: 'Internet baglantisi var' });
    }
  } catch (e) {
    // apiRequest handles consecutiveFailures, only go offline after threshold
    if (wasPreviouslyOnline && !onlineStatus) {
      console.log('[Sync] Went offline:', e.message);
      sendSyncStatus({ status: 'offline', message: 'Internet baglantisi yok' });
    }
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

  // Baslangicta bayat (12h+) bekleyen op'lari temizle - aylardir sikismis retry
  // firtinasi op'lari boylece otomatik dusurulur (backend'i 429/400 ile dovmeyi keser).
  try {
    const purged = db.purgeStalePendingOperations(12);
    if (purged > 0) console.log(`[Sync] Startup: purged ${purged} stale pending ops`);
  } catch (e) {
    console.log('[Sync] Startup purge error (non-critical):', e.message);
  }

  const stats = db.getDatabaseStats();
  console.log('[Sync] Database stats:', stats);

  // If no items, do full sync
  if (stats.itemsCount === 0 && authToken) {
    console.log('[Sync] No cached items, starting full sync...');
    await fullSync();
  }

  // Start auto-sync: every 15 seconds sync deliveries + process pending ops
  startAutoSync(15 * 1000);

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
  syncDeliveries,
  processPendingOperations,
  queueOperation,
  markItemsClean,
  packageDelivery,
  cancelDelivery,
  createWaybill,
  startAutoSync,
  stopAutoSync,
  checkOnlineStatus
};
