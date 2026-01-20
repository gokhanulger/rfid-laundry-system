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
  power?: number;
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

// SQLite Database types
interface DbStats {
  itemsCount: number;
  tenantsCount: number;
  itemTypesCount: number;
  pendingOperationsCount: number;
  lastSyncTime: string | null;
}

interface DbResult {
  success: boolean;
  error?: string;
  stats?: DbStats;
  itemsCount?: number;
}

interface DbItemResult {
  success: boolean;
  error?: string;
  item?: {
    id: string;
    rfid_tag: string;
    tenant_id: string;
    item_type_id: string;
    status: string;
    tenant_name?: string;
    item_type_name?: string;
  };
}

interface SyncStatus {
  status: 'syncing' | 'completed' | 'error';
  message?: string;
  progress?: { page: number; totalItems: number };
  stats?: DbStats;
  error?: string;
}

interface ElectronAPI {
  // Printer API
  getPrinters: () => Promise<PrinterInfo[]>;
  testPrinter: (printerName?: string) => Promise<PrintResult>;
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
  uhfSetPower: (power: number) => Promise<UhfResult>;
  uhfGetPower: () => Promise<UhfResult>;
  uhfScanNetwork: () => Promise<UhfResult>;
  uhfAutoConnect: () => Promise<UhfResult>;
  onUhfStatus: (callback: (status: UhfReaderStatus) => void) => () => void;
  onUhfTag: (callback: (tag: UhfTag) => void) => () => void;
  onUhfScanProgress: (callback: (progress: UhfScanProgress) => void) => () => void;
  onUhfDebug?: (callback: (debug: { type: string; data?: string; cmd?: string; length?: number; dataLen?: number; bytes?: string; poll?: number }) => void) => () => void;

  // SQLite Database API (Offline-first)
  dbInit: (token: string) => Promise<DbResult>;
  dbSetToken: (token: string) => Promise<DbResult>;
  dbFullSync: () => Promise<DbResult>;
  dbDeltaSync: () => Promise<DbResult>;
  dbGetItemByRfid: (rfidTag: string) => Promise<DbItemResult>;
  dbGetStats: () => Promise<{ success: boolean; stats?: DbStats; error?: string }>;
  dbGetTenants: () => Promise<{ success: boolean; tenants?: any[]; error?: string }>;
  dbGetItemTypes: () => Promise<{ success: boolean; itemTypes?: any[]; error?: string }>;
  dbMarkItemsClean: (itemIds: string[]) => Promise<DbResult>;
  dbGetPendingCount: () => Promise<{ success: boolean; count?: number; error?: string }>;
  dbProcessPending: () => Promise<{ success: boolean; processed?: number; failed?: number; remaining?: number; error?: string }>;
  dbIsOnline: () => Promise<{ online: boolean }>;
  onSyncStatus: (callback: (status: SyncStatus) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export type { UhfTag, UhfReaderStatus, UhfReaderConfig };
