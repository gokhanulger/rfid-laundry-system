// Electron API type definitions

interface PrinterInfo {
  name: string;
  displayName: string;
  description: string;
  status: number;
  isDefault: boolean;
  options?: Record<string, string>;
}

interface PrintOptions {
  silent?: boolean;
  printBackground?: boolean;
  deviceName?: string;
  copies?: number;
  printerName?: string;
}

interface PrintResult {
  success: boolean;
  error?: string;
}

interface ElectronAPI {
  getPrinters: () => Promise<PrinterInfo[]>;
  printDocument: (options: PrintOptions) => Promise<PrintResult>;
  printLabel: (html: string, printerName?: string, copies?: number) => Promise<PrintResult>;
  printIrsaliye: (html: string, printerName?: string, copies?: number) => Promise<PrintResult>;
  isElectron: boolean;
  platform: string;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
