const { contextBridge, ipcRenderer } = require('electron');

// Expose printer API to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Get list of available printers
  getPrinters: () => ipcRenderer.invoke('get-printers'),

  // Print current page
  printDocument: (options) => ipcRenderer.invoke('print-document', options),

  // Print label silently to specific printer (60mm x 80mm)
  printLabel: (html, printerName, copies) =>
    ipcRenderer.invoke('print-label', { html, printerName, copies }),

  // Print irsaliye silently to specific printer (205mm x 217.5mm)
  printIrsaliye: (html, printerName, copies) =>
    ipcRenderer.invoke('print-irsaliye', { html, printerName, copies }),

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
  }
});

// Notify that Electron is ready
window.addEventListener('DOMContentLoaded', () => {
  // Ready for use
});
