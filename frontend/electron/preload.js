const { contextBridge, ipcRenderer } = require('electron');

// Expose printer API to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Get list of available printers
  getPrinters: () => ipcRenderer.invoke('get-printers'),

  // Print current page
  printDocument: (options) => ipcRenderer.invoke('print-document', options),

  // Print label silently to specific printer
  printLabel: (html, printerName, copies) =>
    ipcRenderer.invoke('print-label', { html, printerName, copies }),

  // Check if running in Electron
  isElectron: true,

  // Platform info
  platform: process.platform
});

// Notify that Electron is ready
window.addEventListener('DOMContentLoaded', () => {
  console.log('RFID Laundry System - Electron Ready');
  console.log('Platform:', process.platform);
});
