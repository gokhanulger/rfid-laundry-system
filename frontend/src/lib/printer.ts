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
  return !!(window.electronAPI?.isElectron);
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
  if (isElectron() && window.electronAPI) {
    return window.electronAPI.printLabel(
      html,
      options.printerName,
      options.copies || 1
    );
  }

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

// Save preferred printer to localStorage
export function savePreferredPrinter(printerName: string): void {
  localStorage.setItem('preferredPrinter', printerName);
}

// Get preferred printer from localStorage
export function getPreferredPrinter(): string | null {
  return localStorage.getItem('preferredPrinter');
}
