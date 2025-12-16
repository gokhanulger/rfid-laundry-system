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

// UHF RFID Reader types
interface UhfReaderStatus {
  connected: boolean;
  ip?: string;
  port?: number;
  inventoryActive?: boolean;
}

interface UhfReaderConfig {
  ip?: string;
  port?: number;
}

interface UhfTag {
  epc: string;
  antenna: number;
  rssi: number;
  pc?: number;
  count?: number;
  lastSeen?: number;
}

interface UhfResult {
  success: boolean;
  error?: string;
  config?: UhfReaderConfig;
  ip?: string;
  port?: number;
}

interface UhfScanProgress {
  status: 'started' | 'scanning' | 'trying' | 'scanning_range' | 'deep_scan' | 'found' | 'not_found' | 'connecting' | 'verifying' | 'verifying_device';
  message?: string;
  ip?: string;
  port?: number;
  prefix?: string;
  ranges?: string[];
  candidates?: number;
}

interface ElectronAPI {
  // Printer API
  getPrinters: () => Promise<PrinterInfo[]>;
  printDocument: (options: PrintOptions) => Promise<PrintResult>;
  printLabel: (html: string, printerName?: string, copies?: number) => Promise<PrintResult>;
  printIrsaliye: (html: string, printerName?: string, copies?: number) => Promise<PrintResult>;
  isElectron: boolean;
  platform: string;

  // UHF RFID Reader API
  uhfGetStatus: () => Promise<UhfReaderStatus>;
  uhfConnect: (config?: UhfReaderConfig) => Promise<UhfResult>;
  uhfDisconnect: () => Promise<UhfResult>;
  uhfStartInventory: () => Promise<UhfResult>;
  uhfStopInventory: () => Promise<UhfResult>;
  uhfGetTags: () => Promise<UhfTag[]>;
  uhfClearTags: () => Promise<UhfResult>;
  uhfSetConfig: (config: UhfReaderConfig) => Promise<UhfResult>;
  uhfScanNetwork: () => Promise<UhfResult>;
  uhfAutoConnect: () => Promise<UhfResult>;
  onUhfStatus: (callback: (status: UhfReaderStatus) => void) => () => void;
  onUhfTag: (callback: (tag: UhfTag) => void) => () => void;
  onUhfScanProgress: (callback: (progress: UhfScanProgress) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export type { UhfTag, UhfReaderStatus, UhfReaderConfig };
