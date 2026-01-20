const { contextBridge, ipcRenderer } = require('electron');

// Expose printer API to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Get list of available printers
  getPrinters: () => ipcRenderer.invoke('get-printers'),

  // Test printer with a test page
  testPrinter: (printerName) => ipcRenderer.invoke('test-printer', { printerName }),

  // Print current page
  printDocument: (options) => ipcRenderer.invoke('print-document', options),

  // Print label silently to specific printer (80mm x 60mm)
  printLabel: (html, printerName, copies) => {
    console.log('[Preload] printLabel called, printer:', printerName, 'htmlLen:', html?.length);
    return ipcRenderer.invoke('print-label', { html, printerName, copies })
      .then(result => {
        console.log('[Preload] printLabel result:', result);
        return result;
      })
      .catch(err => {
        console.error('[Preload] printLabel error:', err);
        throw err;
      });
  },

  // Print irsaliye silently to specific printer (A4)
  printIrsaliye: (html, printerName, copies) => {
    console.log('[Preload] printIrsaliye called, printer:', printerName, 'htmlLen:', html?.length);
    return ipcRenderer.invoke('print-irsaliye', { html, printerName, copies })
      .then(result => {
        console.log('[Preload] printIrsaliye result:', result);
        // Main process loglarını konsola yaz
        if (result.logs && result.logs.length > 0) {
          console.log('[Main Process Logs]:');
          result.logs.forEach(log => console.log('  ' + log));
        }
        return result;
      })
      .catch(err => {
        console.error('[Preload] printIrsaliye error:', err);
        throw err;
      });
  },

  // Check if running in Electron
  isElectron: true,

  // Platform info
  platform: process.platform,

  // ==========================================
  // UHF RFID Reader API
  // ==========================================

  // Get UHF reader connection status
  uhfGetStatus: () => ipcRenderer.invoke('uhf-get-status'),

  // Connect to UHF reader
  uhfConnect: (config) => ipcRenderer.invoke('uhf-connect', config),

  // Disconnect from UHF reader
  uhfDisconnect: () => ipcRenderer.invoke('uhf-disconnect'),

  // Start inventory (continuous tag reading)
  uhfStartInventory: () => ipcRenderer.invoke('uhf-start-inventory'),

  // Stop inventory
  uhfStopInventory: () => ipcRenderer.invoke('uhf-stop-inventory'),

  // Get all scanned tags
  uhfGetTags: () => ipcRenderer.invoke('uhf-get-tags'),

  // Clear scanned tags
  uhfClearTags: () => ipcRenderer.invoke('uhf-clear-tags'),

  // Set UHF reader configuration
  uhfSetConfig: (config) => ipcRenderer.invoke('uhf-set-config', config),

  // Set RF power level (0-30 dBm) - lower = shorter range
  uhfSetPower: (power) => ipcRenderer.invoke('uhf-set-power', { power }),

  // Get current RF power level
  uhfGetPower: () => ipcRenderer.invoke('uhf-get-power'),

  // Scan network for RFID reader
  uhfScanNetwork: () => ipcRenderer.invoke('uhf-scan-network'),

  // Auto-discover and connect to RFID reader
  uhfAutoConnect: () => ipcRenderer.invoke('uhf-auto-connect'),

  // Listen for UHF reader status changes
  onUhfStatus: (callback) => {
    ipcRenderer.on('uhf-status', (event, status) => callback(status));
    return () => ipcRenderer.removeAllListeners('uhf-status');
  },

  // Listen for UHF tag reads
  onUhfTag: (callback) => {
    ipcRenderer.on('uhf-tag', (event, tag) => callback(tag));
    return () => ipcRenderer.removeAllListeners('uhf-tag');
  },

  // Listen for network scan progress
  onUhfScanProgress: (callback) => {
    ipcRenderer.on('uhf-scan-progress', (event, progress) => callback(progress));
    return () => ipcRenderer.removeAllListeners('uhf-scan-progress');
  },

  // Listen for UHF debug logs
  onUhfLog: (callback) => {
    ipcRenderer.on('uhf-log', (event, log) => callback(log));
    return () => ipcRenderer.removeAllListeners('uhf-log');
  },

  // Listen for UHF debug data (raw packets)
  onUhfDebug: (callback) => {
    ipcRenderer.on('uhf-debug', (event, debug) => callback(debug));
    return () => ipcRenderer.removeAllListeners('uhf-debug');
  },

  // ==========================================
  // SQLite Database API (Offline-first)
  // ==========================================

  // Initialize database with auth token
  dbInit: (token) => ipcRenderer.invoke('db-init', { token }),

  // Set auth token for sync
  dbSetToken: (token) => ipcRenderer.invoke('db-set-token', { token }),

  // Full sync from API to SQLite
  dbFullSync: () => ipcRenderer.invoke('db-full-sync'),

  // Delta sync (only changes)
  dbDeltaSync: () => ipcRenderer.invoke('db-delta-sync'),

  // Get item by RFID tag (fast local lookup - <1ms)
  dbGetItemByRfid: (rfidTag) => ipcRenderer.invoke('db-get-item-by-rfid', { rfidTag }),

  // Get database stats
  dbGetStats: () => ipcRenderer.invoke('db-get-stats'),

  // Get all tenants from local cache
  dbGetTenants: () => ipcRenderer.invoke('db-get-tenants'),

  // Get all item types from local cache
  dbGetItemTypes: () => ipcRenderer.invoke('db-get-item-types'),

  // Mark items as clean (with offline queue support)
  dbMarkItemsClean: (itemIds) => ipcRenderer.invoke('db-mark-items-clean', { itemIds }),

  // Get pending operations count
  dbGetPendingCount: () => ipcRenderer.invoke('db-get-pending-count'),

  // Process pending operations
  dbProcessPending: () => ipcRenderer.invoke('db-process-pending'),

  // Check if online
  dbIsOnline: () => ipcRenderer.invoke('db-is-online'),

  // Debug: Search items in local database
  dbDebugSearch: (searchTerm) => ipcRenderer.invoke('db-debug-search', { searchTerm }),

  // Listen for sync status updates
  onSyncStatus: (callback) => {
    ipcRenderer.on('sync-status', (event, status) => callback(status));
    return () => ipcRenderer.removeAllListeners('sync-status');
  }
});

// Notify that Electron is ready
window.addEventListener('DOMContentLoaded', () => {
  // Ready for use
});
