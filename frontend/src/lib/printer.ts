// Printer utility - works in both Electron and browser

export interface Printer {
  name: string;
  displayName: string;
  isDefault: boolean;
}

export interface PrintOptions {
  printerName?: string;
  copies?: number;
  silent?: boolean;
}

// Check if running in Electron
export function isElectron(): boolean {
  const hasElectronAPI = typeof window !== 'undefined' && window.electronAPI !== undefined;
  const isElectronFlag = hasElectronAPI && window.electronAPI?.isElectron === true;
  return isElectronFlag;
}

// Debug: Log electronAPI status on load
if (typeof window !== 'undefined') {
  console.log('[printer.ts] Module loaded');
  console.log('[printer.ts] window.electronAPI exists:', window.electronAPI !== undefined);
  console.log('[printer.ts] window.electronAPI?.isElectron:', window.electronAPI?.isElectron);
  console.log('[printer.ts] isElectron():', isElectron());
  if (window.electronAPI) {
    console.log('[printer.ts] electronAPI keys:', Object.keys(window.electronAPI));
  }
}

// Get list of available printers
export async function getPrinters(): Promise<Printer[]> {
  if (isElectron() && window.electronAPI) {
    const printers = await window.electronAPI.getPrinters();
    return printers.map(p => ({
      name: p.name,
      displayName: p.displayName || p.name,
      isDefault: p.isDefault
    }));
  }

  // Fallback: No printer list in browser
  console.warn('Printer list not available in browser mode');
  return [];
}

// Print HTML content silently (for labels)
export async function printLabel(
  html: string,
  options: PrintOptions = {}
): Promise<{ success: boolean; error?: string }> {
  console.log('[printer.ts] ========== printLabel START ==========');
  console.log('[printer.ts] HTML length:', html?.length || 0);
  console.log('[printer.ts] Options:', JSON.stringify(options));
  console.log('[printer.ts] isElectron():', isElectron());
  console.log('[printer.ts] window.electronAPI:', window.electronAPI ? 'exists' : 'undefined');
  console.log('[printer.ts] window.electronAPI?.printLabel:', typeof window.electronAPI?.printLabel);

  if (isElectron() && window.electronAPI) {
    console.log('[printer.ts] Using Electron print path...');

    if (typeof window.electronAPI.printLabel !== 'function') {
      console.error('[printer.ts] ERROR: printLabel is not a function!');
      return { success: false, error: 'printLabel is not available in electronAPI' };
    }

    try {
      console.log('[printer.ts] Calling electronAPI.printLabel with:', {
        printerName: options.printerName,
        copies: options.copies || 1,
        htmlLength: html?.length
      });

      const result = await window.electronAPI.printLabel(
        html,
        options.printerName,
        options.copies || 1
      );

      console.log('[printer.ts] printLabel result:', JSON.stringify(result));
      console.log('[printer.ts] ========== printLabel END (success) ==========');
      return result;
    } catch (err) {
      console.error('[printer.ts] printLabel EXCEPTION:', err);
      console.error('[printer.ts] Error type:', typeof err);
      console.error('[printer.ts] Error message:', err instanceof Error ? err.message : String(err));
      console.log('[printer.ts] ========== printLabel END (error) ==========');
      return { success: false, error: String(err) };
    }
  }

  console.log('[printer.ts] Using browser fallback (not Electron)');
  console.log('[printer.ts] ========== printLabel END (browser) ==========');
  // Browser fallback: Open print dialog
  return printInBrowser(html);
}

// Print current page
export async function printPage(
  options: PrintOptions = {}
): Promise<{ success: boolean; error?: string }> {
  if (isElectron() && window.electronAPI) {
    return window.electronAPI.printDocument({
      silent: options.silent || false,
      printerName: options.printerName,
      copies: options.copies || 1
    });
  }

  // Browser fallback
  window.print();
  return { success: true };
}

// Browser fallback printing
function printInBrowser(html: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      resolve({ success: false, error: 'Popup blocked' });
      return;
    }

    printWindow.document.write(html);
    printWindow.document.close();

    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();

      // Close after print dialog
      setTimeout(() => {
        printWindow.close();
        resolve({ success: true });
      }, 1000);
    };
  });
}

// Get default printer name
export async function getDefaultPrinter(): Promise<string | null> {
  const printers = await getPrinters();
  const defaultPrinter = printers.find(p => p.isDefault);
  return defaultPrinter?.name || null;
}

// Save preferred printer to localStorage (for labels)
export function savePreferredPrinter(printerName: string): void {
  localStorage.setItem('preferredPrinter', printerName);
}

// Get preferred printer from localStorage (for labels)
export function getPreferredPrinter(): string | null {
  return localStorage.getItem('preferredPrinter');
}

// Save preferred delivery/irsaliye printer to localStorage
export function saveDeliveryPrinter(printerName: string): void {
  localStorage.setItem('deliveryPrinter', printerName);
}

// Get preferred delivery/irsaliye printer from localStorage
export function getDeliveryPrinter(): string | null {
  return localStorage.getItem('deliveryPrinter');
}

// Save preferred bag label printer to localStorage
export function saveBagPrinter(printerName: string): void {
  localStorage.setItem('bagPrinter', printerName);
}

// Get preferred bag label printer from localStorage
export function getBagPrinter(): string | null {
  return localStorage.getItem('bagPrinter');
}

// Print irsaliye HTML silently (205mm x 215mm paper)
export async function printIrsaliye(
  html: string,
  options: PrintOptions = {}
): Promise<{ success: boolean; error?: string }> {
  const printerName = options.printerName || getDeliveryPrinter() || undefined;

  console.log('[printer.ts] ========== printIrsaliye START ==========');
  console.log('[printer.ts] HTML length:', html?.length || 0);
  console.log('[printer.ts] Printer name:', printerName);
  console.log('[printer.ts] Options:', JSON.stringify(options));
  console.log('[printer.ts] isElectron():', isElectron());
  console.log('[printer.ts] window.electronAPI:', window.electronAPI ? 'exists' : 'undefined');
  console.log('[printer.ts] window.electronAPI?.printIrsaliye:', typeof window.electronAPI?.printIrsaliye);

  if (isElectron() && window.electronAPI) {
    console.log('[printer.ts] Using Electron print path...');

    if (typeof window.electronAPI.printIrsaliye !== 'function') {
      console.error('[printer.ts] ERROR: printIrsaliye is not a function!');
      return { success: false, error: 'printIrsaliye is not available in electronAPI' };
    }

    try {
      console.log('[printer.ts] Calling electronAPI.printIrsaliye with:', {
        printerName,
        copies: options.copies || 1,
        htmlLength: html?.length
      });

      const result = await window.electronAPI.printIrsaliye(
        html,
        printerName,
        options.copies || 1
      );

      console.log('[printer.ts] printIrsaliye result:', JSON.stringify(result));
      console.log('[printer.ts] ========== printIrsaliye END (success) ==========');
      return result;
    } catch (err) {
      console.error('[printer.ts] printIrsaliye EXCEPTION:', err);
      console.error('[printer.ts] Error type:', typeof err);
      console.error('[printer.ts] Error message:', err instanceof Error ? err.message : String(err));
      console.log('[printer.ts] ========== printIrsaliye END (error) ==========');
      return { success: false, error: String(err) };
    }
  }

  console.log('[printer.ts] Using browser fallback (not Electron)');
  console.log('[printer.ts] ========== printIrsaliye END (browser) ==========');
  // Browser fallback: Open print dialog
  return printInBrowser(html);
}

// Print PDF document to specific printer (for A4 documents like irsaliye)
export async function printDocument(
  pdfDataUri: string,
  options: PrintOptions = {}
): Promise<{ success: boolean; error?: string }> {
  if (isElectron() && window.electronAPI) {
    // Create HTML wrapper for PDF
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          @page { size: A4; margin: 0; }
          @media print { html, body { margin: 0; padding: 0; } }
          body { margin: 0; padding: 0; }
          iframe { width: 100%; height: 100vh; border: none; }
        </style>
      </head>
      <body>
        <iframe src="${pdfDataUri}"></iframe>
      </body>
      </html>
    `;
    return window.electronAPI.printLabel(
      html,
      options.printerName || getDeliveryPrinter() || undefined,
      options.copies || 1
    );
  }

  // Browser fallback: Open PDF in new tab for printing
  const printWindow = window.open(pdfDataUri, '_blank');
  if (printWindow) {
    printWindow.focus();
    return { success: true };
  }
  return { success: false, error: 'Popup blocked' };
}
