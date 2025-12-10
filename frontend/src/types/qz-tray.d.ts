declare module 'qz-tray' {
  interface QZ {
    websocket: {
      connect(): Promise<void>;
      disconnect(): Promise<void>;
      isActive(): boolean;
    };
    printers: {
      find(): Promise<string[]>;
      getDefault(): Promise<string>;
    };
    configs: {
      create(printer: string, options?: PrintConfig): PrinterConfig;
    };
    print(config: PrinterConfig, data: PrintData[]): Promise<void>;
  }

  interface PrintConfig {
    size?: { width: number; height: number };
    units?: 'mm' | 'in' | 'cm';
    scaleContent?: boolean;
    margins?: { top: number; right: number; bottom: number; left: number };
    orientation?: 'portrait' | 'landscape';
    copies?: number;
  }

  interface PrinterConfig {
    getPrinter(): string;
    getOptions(): PrintConfig;
  }

  interface PrintData {
    type: 'pdf' | 'image' | 'raw' | 'html';
    data: string;
    format?: string;
  }

  const qz: QZ;
  export default qz;
}
