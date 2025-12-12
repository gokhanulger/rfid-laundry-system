import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, QrCode, Printer, RefreshCw, CheckCircle, Package, X, Trash2, History, Search, Building2, ShoppingBag, Settings } from 'lucide-react';
import { deliveriesApi, settingsApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import type { Delivery, DeliveryPackage } from '../types';
import { jsPDF } from 'jspdf';
import JsBarcode from 'jsbarcode';
import { isElectron, getPrinters, getDeliveryPrinter, saveDeliveryPrinter, type Printer as PrinterType } from '../lib/printer';

interface ScannedPackage {
  delivery: Delivery;
  pkg: DeliveryPackage;
}

interface ItemTypeSummary {
  name: string;
  count: number;
}

interface HotelPackageStatus {
  id: string;
  name: string;
  packagedCount: number;
  deliveries: Delivery[];
  itemSummary: ItemTypeSummary[];
  totalItems: number;
}

// Bag/Sack interface - holds multiple packages
interface Bag {
  id: string;
  bagCode: string;
  packages: ScannedPackage[];
  createdAt: Date;
}

type TabType = 'create' | 'history';

export function IrsaliyePage() {
  const [activeTab, setActiveTab] = useState<TabType>('create');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scannedPackages, setScannedPackages] = useState<ScannedPackage[]>([]);
  const [selectedHotelId, setSelectedHotelId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  // Bags state - holds created bags for current hotel session
  const [bags, setBags] = useState<Bag[]>([]);

  // History tab state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedHotelFilter, setSelectedHotelFilter] = useState<string>('');
  const [expandedDeliveryId, setExpandedDeliveryId] = useState<string | null>(null);

  // Printer settings
  const [printers, setPrinters] = useState<PrinterType[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>(getDeliveryPrinter() || '');
  const [showPrinterSettings, setShowPrinterSettings] = useState(false);

  // Load printers on mount
  useEffect(() => {
    if (isElectron()) {
      getPrinters().then(setPrinters);
    }
  }, []);

  // Save printer selection
  const handlePrinterChange = (printerName: string) => {
    setSelectedPrinter(printerName);
    saveDeliveryPrinter(printerName);
    toast.success(`Irsaliye yazicisi secildi: ${printerName}`);
  };

  // Get tenants for hotel selection
  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: settingsApi.getTenants,
  });

  // Get packaged deliveries ready for irsaliye - auto-refresh every 5 seconds
  const { data: packagedDeliveries, isLoading, refetch } = useQuery({
    queryKey: ['deliveries', { status: 'packaged' }],
    queryFn: () => deliveriesApi.getAll({ status: 'packaged', limit: 100 }),
    refetchInterval: 5000,
  });

  // Get printed deliveries (label_printed status) - auto-refresh
  const { data: printedDeliveries, refetch: refetchPrinted } = useQuery({
    queryKey: ['deliveries', { status: 'label_printed' }],
    queryFn: () => deliveriesApi.getAll({ status: 'label_printed', limit: 100 }),
    refetchInterval: 5000,
  });

  // Get picked_up deliveries (delivered) - auto-refresh
  const { data: pickedUpDeliveries } = useQuery({
    queryKey: ['deliveries', { status: 'picked_up' }],
    queryFn: () => deliveriesApi.getAll({ status: 'picked_up', limit: 100 }),
    refetchInterval: 5000,
  });

  const scanMutation = useMutation({
    mutationFn: async (barcode: string) => {
      const delivery = await deliveriesApi.getByBarcode(barcode.replace(/-PKG\d+$/, ''));
      return { delivery, barcode };
    },
    onSuccess: ({ delivery, barcode }) => {
      if (delivery.status !== 'packaged') {
        toast.warning(`Bu teslimat henuz paketlenmedi (durum: ${delivery.status})`);
        setBarcodeInput('');
        return;
      }

      if (selectedHotelId && delivery.tenantId !== selectedHotelId) {
        toast.error('Bu paket farkli bir otele ait!');
        setBarcodeInput('');
        return;
      }

      let pkg: DeliveryPackage | undefined;
      if (barcode.includes('-PKG')) {
        pkg = delivery.deliveryPackages?.find(p => p.packageBarcode === barcode);
      } else {
        pkg = delivery.deliveryPackages?.[0];
      }

      if (!pkg) {
        pkg = {
          id: `virtual-${delivery.id}`,
          deliveryId: delivery.id,
          packageBarcode: delivery.barcode,
          sequenceNumber: 1,
          status: 'created',
          scannedAt: null,
          scannedBy: null,
          pickedUpAt: null,
          createdAt: delivery.createdAt,
        };
      }

      const alreadyScanned = scannedPackages.some(
        sp => sp.pkg.packageBarcode === pkg!.packageBarcode
      );
      if (alreadyScanned) {
        toast.warning('Bu paket zaten taranmis!');
        setBarcodeInput('');
        return;
      }

      if (!selectedHotelId) {
        setSelectedHotelId(delivery.tenantId);
      }

      setScannedPackages(prev => [...prev, { delivery, pkg: pkg! }]);
      toast.success(`Paket eklendi: ${pkg!.packageBarcode}`);
      setBarcodeInput('');
      inputRef.current?.focus();
    },
    onError: (err) => {
      toast.error('Paket bulunamadi', getErrorMessage(err));
      setBarcodeInput('');
    },
  });

  const handleScan = useCallback(() => {
    if (!barcodeInput.trim()) return;
    scanMutation.mutate(barcodeInput.trim().toUpperCase());
  }, [barcodeInput, scanMutation]);

  // Auto-scan when barcode input changes (for hardware scanner support)
  useEffect(() => {
    if (!barcodeInput.trim() || barcodeInput.length < 5) return;

    // Clear previous debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Auto-trigger scan after 300ms of no input (hardware scanner sends all chars quickly)
    debounceRef.current = setTimeout(() => {
      handleScan();
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [barcodeInput, handleScan]);

  const handleRemovePackage = (index: number) => {
    setScannedPackages(prev => {
      const newPackages = prev.filter((_, i) => i !== index);
      if (newPackages.length === 0) {
        setSelectedHotelId(null);
      }
      return newPackages;
    });
  };

  const handleClearAll = () => {
    setScannedPackages([]);
    setBags([]);
    setSelectedHotelId(null);
  };

  // Clear only scanned packages (keep bags)
  const handleClearScanned = () => {
    setScannedPackages([]);
  };

  // Get all packages in bags for this session
  const packagesInBags = bags.flatMap(bag => bag.packages);

  // Check if a package is already in a bag
  const isPackageInBag = (deliveryId: string) => {
    return packagesInBags.some(sp => sp.delivery.id === deliveryId);
  };

  const calculateTotals = () => {
    const totals: Record<string, { name: string; count: number }> = {};

    scannedPackages.forEach(({ delivery }) => {
      // First try to get from notes (labelExtraData from ironer)
      if (delivery.notes) {
        try {
          const labelData = JSON.parse(delivery.notes);
          if (Array.isArray(labelData)) {
            labelData.forEach((item: any) => {
              const typeName = item.typeName || 'Bilinmeyen';
              const count = item.count || 0;
              if (!totals[typeName]) {
                totals[typeName] = { name: typeName, count: 0 };
              }
              totals[typeName].count += count;
            });
            return; // Skip deliveryItems if we got data from notes
          }
        } catch {}
      }

      // Fallback to deliveryItems
      delivery.deliveryItems?.forEach((di: any) => {
        const typeName = di.item?.itemType?.name || 'Bilinmeyen';
        const typeId = di.item?.itemTypeId || 'unknown';

        if (!totals[typeId]) {
          totals[typeId] = { name: typeName, count: 0 };
        }
        totals[typeId].count++;
      });
    });

    return Object.values(totals);
  };

  // Get item totals for a specific delivery
  const getItemTotals = (delivery: Delivery) => {
    const totals: Record<string, { name: string; count: number }> = {};

    // First try to get from notes (labelExtraData from ironer)
    if (delivery.notes) {
      try {
        const labelData = JSON.parse(delivery.notes);
        if (Array.isArray(labelData)) {
          labelData.forEach((item: any) => {
            const typeName = item.typeName || 'Bilinmeyen';
            const count = item.count || 0;
            if (!totals[typeName]) {
              totals[typeName] = { name: typeName, count: 0 };
            }
            totals[typeName].count += count;
          });
          return Object.values(totals);
        }
      } catch {}
    }

    // Fallback to deliveryItems
    delivery.deliveryItems?.forEach((di: any) => {
      const typeName = di.item?.itemType?.name || 'Bilinmeyen';
      const typeId = di.item?.itemTypeId || 'unknown';

      if (!totals[typeId]) {
        totals[typeId] = { name: typeName, count: 0 };
      }
      totals[typeId].count++;
    });

    return Object.values(totals);
  };

  // Calculate totals including all bags
  const calculateAllTotals = () => {
    const totals: Record<string, { name: string; count: number }> = {};

    // Include packages from all bags
    const allPackages = [...packagesInBags, ...scannedPackages];

    allPackages.forEach(({ delivery }) => {
      if (delivery.notes) {
        try {
          const labelData = JSON.parse(delivery.notes);
          if (Array.isArray(labelData)) {
            labelData.forEach((item: any) => {
              const typeName = item.typeName || 'Bilinmeyen';
              const count = item.count || 0;
              if (!totals[typeName]) {
                totals[typeName] = { name: typeName, count: 0 };
              }
              totals[typeName].count += count;
            });
            return;
          }
        } catch {}
      }

      delivery.deliveryItems?.forEach((di: any) => {
        const typeName = di.item?.itemType?.name || 'Bilinmeyen';
        const typeId = di.item?.itemTypeId || 'unknown';
        if (!totals[typeId]) {
          totals[typeId] = { name: typeName, count: 0 };
        }
        totals[typeId].count++;
      });
    });

    return Object.values(totals);
  };

  const generateIrsaliyePDF = async () => {
    // Need at least some packages (in bags or scanned)
    const allPackages = [...packagesInBags, ...scannedPackages];
    if (allPackages.length === 0) {
      toast.error('Lutfen once paketleri secin');
      return;
    }

    const hotel = tenants?.find(t => t.id === selectedHotelId);
    const totals = calculateAllTotals();
    const documentNo = `A-${Date.now().toString().slice(-9)}`;
    const today = new Date().toLocaleDateString('tr-TR');
    const totalPackageCount = allPackages.length;

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let yPos = 20;

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('TEMIZ IRSALIYESI', pageWidth - margin, yPos, { align: 'right' });

    yPos += 10;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Sayin:', margin, yPos);
    yPos += 5;
    doc.setFontSize(12);
    doc.text(hotel?.name || 'Bilinmeyen Otel', margin, yPos);
    yPos += 5;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    if (hotel?.address) {
      const addressLines = hotel.address.split('\n');
      addressLines.forEach(line => {
        doc.text(line, margin, yPos);
        yPos += 4;
      });
    }

    const rightX = pageWidth - margin - 60;
    let rightY = 30;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Tarih:', rightX, rightY);
    doc.setFont('helvetica', 'normal');
    doc.text(documentNo, rightX + 30, rightY);
    rightY += 5;
    doc.text(today, rightX + 30, rightY);
    rightY += 5;
    doc.text(today, rightX + 30, rightY);

    yPos = Math.max(yPos, rightY) + 10;

    doc.setLineWidth(0.5);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 5;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('CINSI', margin, yPos);
    doc.text('MIKTARI', pageWidth - margin - 20, yPos, { align: 'right' });

    yPos += 3;
    doc.setLineWidth(0.3);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 7;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);

    totals.forEach(item => {
      doc.text(item.name.toUpperCase(), margin, yPos);
      doc.text(item.count.toString(), pageWidth - margin - 20, yPos, { align: 'right' });
      yPos += 8;
    });

    yPos += 10;

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('CUVAL SAYISI :', margin, yPos);
    doc.text(bags.length.toString(), pageWidth - margin - 20, yPos, { align: 'right' });

    yPos += 8;

    doc.text('PAKET SAYISI :', margin, yPos);
    doc.text(totalPackageCount.toString(), pageWidth - margin - 20, yPos, { align: 'right' });

    yPos += 15;

    doc.setLineWidth(0.5);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 15;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const sigWidth = (pageWidth - margin * 2) / 2;

    doc.text('Teslim Eden', margin + sigWidth / 2, yPos, { align: 'center' });
    doc.text('Teslim Alan', margin + sigWidth + sigWidth / 2, yPos, { align: 'center' });

    yPos += 20;

    doc.setLineWidth(0.3);
    doc.line(margin + 10, yPos, margin + sigWidth - 10, yPos);
    doc.line(margin + sigWidth + 10, yPos, pageWidth - margin - 10, yPos);

    yPos = doc.internal.pageSize.getHeight() - 15;
    doc.setFontSize(8);
    doc.text('RFID Camasirhane Sistemi', pageWidth / 2, yPos, { align: 'center' });

    // Print to selected printer or show print dialog
    const pdfDataUri = doc.output('datauristring');

    if (isElectron() && selectedPrinter) {
      // Electron: Create printable HTML and send to printer
      const printHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            @page { size: A4; margin: 0; }
            @media print { html, body { margin: 0; padding: 0; } }
            body { margin: 0; padding: 0; }
            embed { width: 100%; height: 100vh; }
          </style>
        </head>
        <body>
          <embed src="${pdfDataUri}" type="application/pdf" width="100%" height="100%">
        </body>
        </html>
      `;

      try {
        const result = await window.electronAPI?.printLabel(printHtml, selectedPrinter, 1);
        if (result?.success) {
          toast.success('Irsaliye yaziciya gonderildi!');
        } else {
          // Fallback: save as file
          const filename = `irsaliye-${hotel?.name?.replace(/\s+/g, '-') || 'otel'}-${documentNo}.pdf`;
          doc.save(filename);
          toast.info('Yazici hatasi, dosya olarak kaydedildi');
        }
      } catch {
        const filename = `irsaliye-${hotel?.name?.replace(/\s+/g, '-') || 'otel'}-${documentNo}.pdf`;
        doc.save(filename);
      }
    } else {
      // Browser or no printer selected: Open print dialog
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html>
          <head><title>Irsaliye</title></head>
          <body style="margin:0">
            <embed src="${pdfDataUri}" type="application/pdf" width="100%" height="100%" style="position:absolute;top:0;left:0;right:0;bottom:0;">
          </body>
          </html>
        `);
        printWindow.document.close();
        setTimeout(() => {
          printWindow.focus();
          printWindow.print();
        }, 500);
      }
    }

    // Get unique delivery IDs from all packages and mark them as picked_up
    const uniqueDeliveryIds = [...new Set(allPackages.map(({ delivery }) => delivery.id))];

    // Call pickup API for each unique delivery
    try {
      await Promise.all(uniqueDeliveryIds.map(id => deliveriesApi.pickup(id)));
      toast.success(`${totalPackageCount} paket sofor teslimatina eklendi.`);
    } catch (error) {
      toast.warning('Bazi paketler sofor sistemine eklenemedi.');
    }

    // Clear everything and exit hotel view
    handleClearAll();
    setSelectedHotelId(null);
    queryClient.invalidateQueries({ queryKey: ['deliveries'] });
    refetch();
    refetchPrinted();
  };

  // Reprint irsaliye for a past delivery
  const handleReprintIrsaliye = (delivery: Delivery) => {
    const hotel = tenants?.find(t => t.id === delivery.tenantId);
    const totals = getItemTotals(delivery);
    const documentNo = `A-${delivery.barcode.slice(-9)}`;
    const date = new Date(delivery.labelPrintedAt || delivery.createdAt).toLocaleDateString('tr-TR');

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let yPos = 20;

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('TEMIZ IRSALIYESI', pageWidth - margin, yPos, { align: 'right' });

    yPos += 10;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Sayin:', margin, yPos);
    yPos += 5;
    doc.setFontSize(12);
    doc.text(hotel?.name || delivery.tenant?.name || 'Bilinmeyen Otel', margin, yPos);
    yPos += 5;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    if (hotel?.address) {
      const addressLines = hotel.address.split('\n');
      addressLines.forEach(line => {
        doc.text(line, margin, yPos);
        yPos += 4;
      });
    }

    const rightX = pageWidth - margin - 60;
    let rightY = 30;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Belge No:', rightX, rightY);
    doc.setFont('helvetica', 'normal');
    doc.text(documentNo, rightX + 30, rightY);
    rightY += 5;
    doc.setFont('helvetica', 'bold');
    doc.text('Tarih:', rightX, rightY);
    doc.setFont('helvetica', 'normal');
    doc.text(date, rightX + 30, rightY);

    yPos = Math.max(yPos, rightY) + 15;

    doc.setLineWidth(0.5);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('CINSI', margin, yPos);
    doc.text('MIKTARI', pageWidth - margin - 20, yPos, { align: 'right' });

    yPos += 3;
    doc.setLineWidth(0.3);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 7;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);

    totals.forEach(item => {
      doc.text(item.name.toUpperCase(), margin, yPos);
      doc.text(item.count.toString(), pageWidth - margin - 20, yPos, { align: 'right' });
      yPos += 8;
    });

    yPos += 10;

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('PAKET SAYISI :', margin, yPos);
    doc.text((delivery.packageCount || 1).toString(), pageWidth - margin - 20, yPos, { align: 'right' });

    yPos += 5;

    const totalItems = delivery.deliveryItems?.length || 0;
    doc.setFontSize(12);
    doc.text('TOPLAM URUN :', margin, yPos);
    doc.text(totalItems.toString(), pageWidth - margin - 20, yPos, { align: 'right' });

    yPos += 20;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Barkod: ${delivery.barcode}`, margin, yPos);

    yPos += 15;

    doc.setLineWidth(0.5);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 15;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const sigWidth = (pageWidth - margin * 2) / 2;

    doc.text('Teslim Eden', margin + sigWidth / 2, yPos, { align: 'center' });
    doc.text('Teslim Alan', margin + sigWidth + sigWidth / 2, yPos, { align: 'center' });

    yPos += 20;

    doc.setLineWidth(0.3);
    doc.line(margin + 10, yPos, margin + sigWidth - 10, yPos);
    doc.line(margin + sigWidth + 10, yPos, pageWidth - margin - 10, yPos);

    yPos = doc.internal.pageSize.getHeight() - 15;
    doc.setFontSize(8);
    doc.text('RFID Camasirhane Sistemi', pageWidth / 2, yPos, { align: 'center' });

    const filename = `irsaliye-${hotel?.name?.replace(/\s+/g, '-') || 'otel'}-${documentNo}.pdf`;
    doc.save(filename);

    toast.success('Irsaliye yeniden yazdirildi!');
  };

  // Generate bag label for driver scanning
  const generateBagLabel = async () => {
    if (scannedPackages.length === 0) {
      toast.error('Lutfen once paketleri tarayin');
      return;
    }

    try {
      // Get unique delivery IDs
      const uniqueDeliveryIds = [...new Set(scannedPackages.map(({ delivery }) => delivery.id))];

      // Create bag via API
      const bagResult = await deliveriesApi.createBag(uniqueDeliveryIds);
      const bagCode = bagResult.bagCode;

      const hotel = tenants?.find(t => t.id === selectedHotelId);
      const totals = calculateTotals();
      const today = new Date().toLocaleDateString('tr-TR');

      // Create PDF label (60mm x 80mm)
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [60, 80],
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 3;
      let yPos = 5;

      // Header
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('CUVAL', pageWidth / 2, yPos, { align: 'center' });

      yPos += 5;

      // Hotel name (truncate if too long)
      doc.setFontSize(8);
      const hotelName = hotel?.name || 'Bilinmeyen Otel';
      const truncatedName = hotelName.length > 20 ? hotelName.substring(0, 18) + '...' : hotelName;
      doc.text(truncatedName, pageWidth / 2, yPos, { align: 'center' });

      yPos += 4;

      // Date and package count
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.text(`${today} - ${scannedPackages.length} Paket`, pageWidth / 2, yPos, { align: 'center' });

      yPos += 5;

      // Items list (compact)
      doc.setFontSize(6);
      doc.setLineWidth(0.2);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 3;

      // Show max 4 items
      const displayTotals = totals.slice(0, 4);
      displayTotals.forEach(item => {
        const itemName = item.name.length > 12 ? item.name.substring(0, 10) + '..' : item.name;
        doc.text(itemName, margin, yPos);
        doc.text(`${item.count}`, pageWidth - margin, yPos, { align: 'right' });
        yPos += 3.5;
      });
      if (totals.length > 4) {
        doc.text(`+${totals.length - 4} tur daha`, margin, yPos);
        yPos += 3.5;
      }

      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 4;

      // Generate barcode as SVG, convert to image
      const canvas = document.createElement('canvas');
      JsBarcode(canvas, bagCode, {
        format: 'CODE128',
        width: 1.5,
        height: 30,
        displayValue: true,
        fontSize: 10,
        margin: 2,
      });

      // Add barcode image to PDF
      const barcodeDataUrl = canvas.toDataURL('image/png');
      const barcodeWidth = pageWidth - margin * 2;
      const barcodeHeight = 18;
      doc.addImage(barcodeDataUrl, 'PNG', margin, yPos, barcodeWidth, barcodeHeight);

      yPos += barcodeHeight + 3;

      // Footer
      doc.setFontSize(5);
      doc.text('El terminalinden okutun', pageWidth / 2, yPos, { align: 'center' });

      // Save PDF
      const filename = `cuval-${hotel?.name?.replace(/\s+/g, '-') || 'otel'}-${bagCode}.pdf`;
      doc.save(filename);

      // DON'T mark packages as picked up yet - wait for irsaliye
      // Just add the packages to a bag for visual tracking

      // Add bag to bags list (visual tracking)
      const newBag: Bag = {
        id: `bag-${Date.now()}`,
        bagCode,
        packages: [...scannedPackages],
        createdAt: new Date(),
      };
      setBags(prev => [...prev, newBag]);

      toast.success(`Cuval etiketi basildi! ${scannedPackages.length} paket ${bagCode} cuvalina eklendi. Diger paketleri secmeye devam edin.`);

      // Clear scanned packages but STAY on hotel view
      handleClearScanned();

      // Refresh to get updated data
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      refetch();
    } catch (error) {
      toast.error('Cuval etiketi olusturulamadi', getErrorMessage(error));
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'label_printed':
        return <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">Etiket Basildi</span>;
      case 'picked_up':
        return <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">Teslim Edildi</span>;
      default:
        return <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">{status}</span>;
    }
  };

  const selectedHotel = tenants?.find(t => t.id === selectedHotelId);
  const totals = calculateTotals();
  const packagedList = packagedDeliveries?.data || [];

  // Group packaged deliveries by hotel with item summary
  const hotelPackageStatuses: HotelPackageStatus[] = (tenants || []).map(tenant => {
    const hotelDeliveries = packagedList.filter((d: Delivery) => d.tenantId === tenant.id);

    // Calculate item summary for this hotel
    const itemTotals: Record<string, { name: string; count: number }> = {};
    let totalItems = 0;

    hotelDeliveries.forEach((delivery: Delivery) => {
      // Try to get items from notes (labelExtraData stored as JSON)
      if (delivery.notes) {
        try {
          const labelData = JSON.parse(delivery.notes);
          if (Array.isArray(labelData)) {
            labelData.forEach((item: any) => {
              const typeName = item.typeName || 'Bilinmeyen';
              const count = item.count || 0;
              if (!itemTotals[typeName]) {
                itemTotals[typeName] = { name: typeName, count: 0 };
              }
              itemTotals[typeName].count += count;
              totalItems += count;
            });
            return;
          }
        } catch {}
      }

      // Fallback to deliveryItems
      delivery.deliveryItems?.forEach((di: any) => {
        const typeName = di.item?.itemType?.name || 'Bilinmeyen';
        if (!itemTotals[typeName]) {
          itemTotals[typeName] = { name: typeName, count: 0 };
        }
        itemTotals[typeName].count++;
        totalItems++;
      });
    });

    return {
      id: tenant.id,
      name: tenant.name,
      packagedCount: hotelDeliveries.length,
      deliveries: hotelDeliveries,
      itemSummary: Object.values(itemTotals),
      totalItems,
    };
  }).filter(h => h.packagedCount > 0);

  // Combine printed and picked up deliveries for history
  const allDeliveries = [
    ...(printedDeliveries?.data || []),
    ...(pickedUpDeliveries?.data || []),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Filter deliveries for history
  const filteredDeliveries = allDeliveries.filter(delivery => {
    const matchesSearch = searchTerm === '' ||
      delivery.barcode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      delivery.tenant?.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesHotel = selectedHotelFilter === '' || delivery.tenantId === selectedHotelFilter;
    return matchesSearch && matchesHotel;
  });

  const handleRefresh = () => {
    refetch();
    refetchPrinted();
  };

  // Handle hotel card click - toggle selection
  const handleHotelClick = (hotelId: string) => {
    if (selectedHotelId === hotelId) {
      // Deselect if clicking same hotel
      setSelectedHotelId(null);
      setScannedPackages([]);
    } else {
      setSelectedHotelId(hotelId);
      setScannedPackages([]);
    }
  };

  // Get selected hotel's deliveries
  const selectedHotelDeliveries = packagedList.filter((d: Delivery) => d.tenantId === selectedHotelId);

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-teal-100 rounded-lg">
            <FileText className="w-8 h-8 text-teal-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Irsaliye</h1>
            <p className="text-gray-500">Otel bazli paket yonetimi</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isElectron() && (
            <button
              onClick={() => setShowPrinterSettings(true)}
              className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg border"
            >
              <Settings className="w-4 h-4" />
              Yazici: {selectedPrinter || 'Secilmedi'}
            </button>
          )}
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <RefreshCw className="w-4 h-4" />
            Yenile
          </button>
        </div>
      </div>

      {/* Printer Settings Modal */}
      {showPrinterSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Printer className="w-6 h-6 text-teal-600" />
                Irsaliye Yazicisi
              </h2>
              <button
                onClick={() => setShowPrinterSettings(false)}
                className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-gray-600 text-sm mb-4">
              Irsaliyeler bu yazicidan yazdirilacak (A4 kagit)
            </p>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {printers.length === 0 ? (
                <p className="text-gray-500 text-center py-4">Yazici bulunamadi</p>
              ) : (
                printers.map(printer => (
                  <button
                    key={printer.name}
                    onClick={() => {
                      handlePrinterChange(printer.name);
                      setShowPrinterSettings(false);
                    }}
                    className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                      selectedPrinter === printer.name
                        ? 'border-teal-500 bg-teal-50 text-teal-700'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{printer.displayName}</span>
                      {printer.isDefault && (
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">Varsayilan</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{printer.name}</p>
                  </button>
                ))
              )}
            </div>

            <div className="mt-4 pt-4 border-t">
              <button
                onClick={() => setShowPrinterSettings(false)}
                className="w-full py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-lg overflow-hidden">
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('create')}
            className={`flex-1 px-6 py-4 text-center font-medium transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'create'
                ? 'bg-teal-50 text-teal-700 border-b-2 border-teal-600'
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            <QrCode className="w-5 h-5" />
            Yeni Irsaliye
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 px-6 py-4 text-center font-medium transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'history'
                ? 'bg-teal-50 text-teal-700 border-b-2 border-teal-600'
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            <History className="w-5 h-5" />
            Basilan Irsaliyeler
            {allDeliveries.length > 0 && (
              <span className="px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full text-xs font-bold">
                {allDeliveries.length}
              </span>
            )}
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'create' ? (
            /* CREATE TAB - Hotel Grid View */
            <div className="space-y-6">
              {/* Legend */}
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-6">
                  <span className="text-sm font-medium text-gray-700">Durum:</span>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-yellow-400 border-2 border-yellow-500 rounded"></div>
                    <span className="text-sm text-gray-600">Paketlendi - Irsaliye Bekliyor</span>
                  </div>
                </div>
              </div>

              {/* Hotel Grid */}
              {isLoading ? (
                <div className="flex items-center justify-center h-64">
                  <RefreshCw className="w-8 h-8 animate-spin text-teal-500" />
                </div>
              ) : hotelPackageStatuses.length === 0 ? (
                <div className="p-16 text-center bg-gray-50 rounded-xl">
                  <Package className="w-20 h-20 mx-auto text-gray-300 mb-4" />
                  <p className="text-2xl font-semibold text-gray-500">Paketlenmis teslimat yok</p>
                  <p className="text-lg text-gray-400 mt-2">Tum paketler teslim edilmis</p>
                </div>
              ) : (
                <div className="bg-white rounded-xl p-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {hotelPackageStatuses.map((hotel) => (
                      <button
                        key={hotel.id}
                        onClick={() => handleHotelClick(hotel.id)}
                        className="
                          relative rounded-xl border-2 p-4
                          bg-yellow-400 border-yellow-500 text-yellow-900
                          hover:scale-[1.02] hover:shadow-lg transition-all duration-200
                          flex flex-col items-start
                          cursor-pointer text-left
                        "
                        title={hotel.name}
                      >
                        {/* Header */}
                        <div className="flex items-center gap-2 mb-3 w-full">
                          <Building2 className="w-6 h-6 opacity-75 flex-shrink-0" />
                          <span className="font-bold text-lg leading-tight line-clamp-1 flex-1">
                            {hotel.name}
                          </span>
                          <span className="w-8 h-8 bg-teal-600 text-white text-sm rounded-full flex items-center justify-center font-bold shadow-md flex-shrink-0">
                            {hotel.packagedCount}
                          </span>
                        </div>

                        {/* Item Summary */}
                        <div className="w-full space-y-1 bg-yellow-300/50 rounded-lg p-2 mb-2">
                          {hotel.itemSummary.length > 0 ? (
                            hotel.itemSummary.slice(0, 4).map((item, idx) => (
                              <div key={idx} className="flex justify-between text-sm">
                                <span className="truncate">{item.name}</span>
                                <span className="font-bold ml-2">{item.count} adet</span>
                              </div>
                            ))
                          ) : (
                            <div className="text-sm text-yellow-700 italic">Icerik bilgisi yok</div>
                          )}
                          {hotel.itemSummary.length > 4 && (
                            <div className="text-xs text-yellow-700 mt-1">
                              +{hotel.itemSummary.length - 4} tur daha...
                            </div>
                          )}
                        </div>

                        {/* Footer Stats */}
                        <div className="flex justify-between w-full text-xs text-yellow-800">
                          <span>{hotel.packagedCount} paket</span>
                          <span className="font-bold">{hotel.totalItems} urun</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-3xl font-bold text-teal-600">{hotelPackageStatuses.length}</p>
                  <p className="text-sm text-gray-500">Paketli Otel</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-3xl font-bold text-yellow-600">{packagedList.length}</p>
                  <p className="text-sm text-gray-500">Toplam Paket</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-3xl font-bold text-green-600">{allDeliveries.length}</p>
                  <p className="text-sm text-gray-500">Basilan Irsaliye</p>
                </div>
              </div>

              {/* Selected Hotel Detail - Inline */}
              {selectedHotelId && (
                <div className="bg-gradient-to-r from-teal-50 to-teal-100 rounded-xl border-2 border-teal-300 overflow-hidden">
                  {/* Hotel Header */}
                  <div className="bg-gradient-to-r from-teal-600 to-teal-500 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Building2 className="w-8 h-8 text-white" />
                        <div>
                          <h2 className="text-xl font-bold text-white">{selectedHotel?.name}</h2>
                          <p className="text-teal-100">{selectedHotelDeliveries.length} paket hazir</p>
                        </div>
                      </div>
                      <button
                        onClick={() => { setSelectedHotelId(null); handleClearAll(); }}
                        className="p-2 text-white hover:bg-white/20 rounded-lg"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  <div className="p-4">
                    {/* Scanner and Packages Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      {/* Left: Scanner */}
                      <div className="space-y-4">
                        <div className="bg-white rounded-xl p-4 border shadow-sm">
                          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                            <QrCode className="w-4 h-4 text-teal-600" />
                            Barkod Tara
                          </h3>
                          <input
                            ref={inputRef}
                            type="text"
                            value={barcodeInput}
                            onChange={(e) => setBarcodeInput(e.target.value.toUpperCase())}
                            onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                            placeholder="Barkod okutun..."
                            className="w-full px-3 py-2 text-sm border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 font-mono"
                            autoFocus
                          />
                          {scanMutation.isPending && (
                            <p className="text-xs text-teal-600 mt-1">Ekleniyor...</p>
                          )}
                        </div>

                        {/* Created Bags Display */}
                        {bags.length > 0 && (
                          <div className="bg-orange-50 rounded-xl border-2 border-orange-200 p-4 shadow-sm">
                            <h3 className="font-semibold mb-2 text-sm flex items-center gap-2 text-orange-800">
                              <ShoppingBag className="w-4 h-4" />
                              Olusturulan Cuvallar ({bags.length})
                            </h3>
                            <div className="space-y-2">
                              {bags.map((bag, idx) => (
                                <div key={bag.id} className="bg-white rounded-lg p-2 border border-orange-200">
                                  <div className="flex items-center justify-between">
                                    <span className="font-mono text-xs font-bold text-orange-700">
                                      Cuval {idx + 1}: {bag.bagCode}
                                    </span>
                                    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                                      {bag.packages.length} paket
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="mt-3 pt-2 border-t border-orange-200 flex items-center justify-between text-sm">
                              <span className="font-bold text-orange-800">TOPLAM</span>
                              <span className="font-bold text-orange-700">{packagesInBags.length} paket</span>
                            </div>
                          </div>
                        )}

                        {/* Summary for currently selected packages */}
                        {totals.length > 0 && (
                          <div className="bg-white rounded-xl border p-4 shadow-sm">
                            <h3 className="font-semibold mb-2 text-sm">Secilen Urunler (Yeni Cuval)</h3>
                            <div className="space-y-1 mb-3">
                              {totals.map((item, index) => (
                                <div key={index} className="flex items-center justify-between py-1 border-b last:border-0 text-sm">
                                  <span>{item.name}</span>
                                  <span className="font-bold text-teal-600">{item.count} adet</span>
                                </div>
                              ))}
                            </div>
                            <div className="pt-2 border-t flex items-center justify-between">
                              <span className="font-bold text-sm">PAKET</span>
                              <span className="text-lg font-bold text-teal-700">{scannedPackages.length}</span>
                            </div>
                          </div>
                        )}

                        {/* Buttons - always show when hotel selected */}
                        <div className="space-y-2">
                          {/* Tümünü Seç butonu - hiç paket seçilmemişse */}
                          {scannedPackages.length === 0 && bags.length === 0 && selectedHotelDeliveries.length > 0 && (
                            <button
                              onClick={() => {
                                const availableDeliveries = selectedHotelDeliveries.filter(
                                  (d: Delivery) => !isPackageInBag(d.id)
                                );
                                availableDeliveries.forEach((delivery: Delivery) => {
                                  const pkg = delivery.deliveryPackages?.[0] || {
                                    id: `virtual-${delivery.id}`,
                                    deliveryId: delivery.id,
                                    packageBarcode: delivery.barcode,
                                    sequenceNumber: 1,
                                    status: 'created',
                                    scannedAt: null,
                                    scannedBy: null,
                                    pickedUpAt: null,
                                    createdAt: delivery.createdAt,
                                  };
                                  setScannedPackages(prev => [...prev, { delivery, pkg }]);
                                });
                                toast.success(`${availableDeliveries.length} paket eklendi`);
                              }}
                              className="w-full py-3 bg-blue-500 text-white rounded-xl hover:bg-blue-600 font-bold flex items-center justify-center gap-2 shadow-lg"
                            >
                              <Package className="w-5 h-5" />
                              TUMUNU SEC ({selectedHotelDeliveries.filter((d: Delivery) => !isPackageInBag(d.id)).length} paket)
                            </button>
                          )}

                          {/* Paketler seçildiyse - İrsaliye Yazdır ve opsiyonel Çuval Etiketi */}
                          {(scannedPackages.length > 0 || bags.length > 0) && (
                            <>
                              {/* Ana buton: İrsaliye Yazdır */}
                              <button
                                onClick={generateIrsaliyePDF}
                                className="w-full py-3 bg-teal-600 text-white rounded-xl hover:bg-teal-700 font-bold flex items-center justify-center gap-2 shadow-lg"
                              >
                                <Printer className="w-5 h-5" />
                                IRSALIYE YAZDIR ({scannedPackages.length + packagesInBags.length} paket)
                              </button>

                              {/* Opsiyonel: Çuval Etiketi Bas */}
                              {scannedPackages.length > 0 && (
                                <button
                                  onClick={generateBagLabel}
                                  className="w-full py-2 bg-orange-100 text-orange-700 border-2 border-orange-300 rounded-xl hover:bg-orange-200 font-medium flex items-center justify-center gap-2"
                                >
                                  <ShoppingBag className="w-4 h-4" />
                                  Cuval Etiketi Bas (opsiyonel)
                                </button>
                              )}

                              <p className="text-xs text-center text-gray-500">
                                {bags.length > 0
                                  ? `${bags.length} cuval + ${scannedPackages.length} yeni paket`
                                  : 'Cuval etiketi opsiyoneldir'}
                              </p>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Right: All Packages as Grid */}
                      <div className="lg:col-span-2">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="font-semibold flex items-center gap-2">
                            <Package className="w-5 h-5 text-teal-600" />
                            Hazir Paketler
                          </h3>
                          {scannedPackages.length > 0 && (
                            <button
                              onClick={handleClearAll}
                              className="text-xs text-red-600 hover:text-red-800 flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" />
                              Temizle
                            </button>
                          )}
                        </div>

                        {selectedHotelDeliveries.length === 0 ? (
                          <div className="p-8 text-center bg-white rounded-xl text-gray-500">
                            <Package className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                            <p>Bu otele ait hazir paket yok</p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                            {selectedHotelDeliveries.map((delivery: Delivery) => {
                              const isScanned = scannedPackages.some(sp => sp.delivery.id === delivery.id);
                              const inBag = isPackageInBag(delivery.id);
                              const bagIndex = bags.findIndex(bag =>
                                bag.packages.some(sp => sp.delivery.id === delivery.id)
                              );

                              // Get item summary for this delivery
                              let deliveryItems: { name: string; count: number }[] = [];
                              if (delivery.notes) {
                                try {
                                  const labelData = JSON.parse(delivery.notes);
                                  if (Array.isArray(labelData)) {
                                    deliveryItems = labelData.map((item: any) => ({
                                      name: item.typeName || 'Bilinmeyen',
                                      count: item.count || 0
                                    }));
                                  }
                                } catch {}
                              }
                              if (deliveryItems.length === 0 && delivery.deliveryItems) {
                                const itemTotals: Record<string, { name: string; count: number }> = {};
                                delivery.deliveryItems.forEach((di: any) => {
                                  const typeName = di.item?.itemType?.name || 'Bilinmeyen';
                                  if (!itemTotals[typeName]) {
                                    itemTotals[typeName] = { name: typeName, count: 0 };
                                  }
                                  itemTotals[typeName].count++;
                                });
                                deliveryItems = Object.values(itemTotals);
                              }

                              return (
                                <button
                                  key={delivery.id}
                                  onClick={() => {
                                    if (inBag) {
                                      // Already in bag, don't allow changes
                                      toast.warning('Bu paket zaten bir cuvalda!');
                                      return;
                                    }
                                    if (!isScanned) {
                                      setBarcodeInput(delivery.barcode);
                                      setTimeout(() => handleScan(), 100);
                                    } else {
                                      // Remove from scanned
                                      const idx = scannedPackages.findIndex(sp => sp.delivery.id === delivery.id);
                                      if (idx >= 0) handleRemovePackage(idx);
                                    }
                                  }}
                                  disabled={inBag}
                                  className={`
                                    relative rounded-xl border-2 p-3 text-left
                                    transition-all duration-200
                                    ${inBag
                                      ? 'bg-green-500 border-green-600 text-white cursor-not-allowed shadow-lg'
                                      : isScanned
                                        ? 'bg-green-400 border-green-500 text-white shadow-lg scale-[1.02]'
                                        : 'bg-yellow-100 border-yellow-400 text-yellow-900 hover:border-yellow-500 hover:shadow-md'
                                    }
                                  `}
                                >
                                  {inBag && (
                                    <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-700 rounded-full flex items-center justify-center shadow">
                                      <CheckCircle className="w-4 h-4 text-white" />
                                    </div>
                                  )}
                                  {isScanned && !inBag && (
                                    <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-600 rounded-full flex items-center justify-center shadow">
                                      <CheckCircle className="w-4 h-4 text-white" />
                                    </div>
                                  )}

                                  {inBag && (
                                    <p className="text-xs font-bold text-green-100 mb-1">
                                      🟢 Cuval {bagIndex + 1}
                                    </p>
                                  )}

                                  <p className={`font-mono text-xs font-bold mb-2 ${inBag ? 'text-white' : isScanned ? 'text-white' : 'text-yellow-800'}`}>
                                    {delivery.barcode.slice(-8)}
                                  </p>

                                  <div className={`space-y-0.5 text-xs ${inBag ? 'text-green-100' : isScanned ? 'text-green-100' : 'text-yellow-700'}`}>
                                    {deliveryItems.slice(0, 3).map((item, idx) => (
                                      <div key={idx} className="flex justify-between">
                                        <span className="truncate">{item.name}</span>
                                        <span className="font-medium ml-1">{item.count}</span>
                                      </div>
                                    ))}
                                    {deliveryItems.length > 3 && (
                                      <p className="text-xs opacity-70">+{deliveryItems.length - 3} tur</p>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* HISTORY TAB */
            <div className="space-y-6">
              {/* Filters */}
              <div className="flex flex-wrap gap-4">
                <div className="flex-1 min-w-[200px]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Barkod veya otel ara..."
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    />
                  </div>
                </div>

                <div className="min-w-[200px]">
                  <select
                    value={selectedHotelFilter}
                    onChange={(e) => setSelectedHotelFilter(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  >
                    <option value="">Tum Oteller</option>
                    {tenants?.map(tenant => (
                      <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-3xl font-bold text-teal-600">{allDeliveries.length}</p>
                  <p className="text-sm text-gray-500">Toplam Irsaliye</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-3xl font-bold text-blue-600">{printedDeliveries?.data?.length || 0}</p>
                  <p className="text-sm text-gray-500">Bekleyen</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-3xl font-bold text-green-600">{pickedUpDeliveries?.data?.length || 0}</p>
                  <p className="text-sm text-gray-500">Teslim Edildi</p>
                </div>
              </div>

              {/* Main Content - List on left, Preview on right */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Deliveries List */}
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {filteredDeliveries.length === 0 ? (
                    <div className="p-12 text-center bg-gray-50 rounded-xl">
                      <FileText className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                      <p className="text-xl text-gray-500">Irsaliye bulunamadi</p>
                      <p className="text-gray-400 mt-2">Filtreleri degistirmeyi deneyin</p>
                    </div>
                  ) : (
                    filteredDeliveries.map(delivery => {
                      const isSelected = expandedDeliveryId === delivery.id;

                      return (
                        <div
                          key={delivery.id}
                          className={`bg-white border rounded-xl overflow-hidden cursor-pointer transition-all ${
                            isSelected ? 'border-teal-500 ring-2 ring-teal-200' : 'hover:border-gray-300'
                          }`}
                          onClick={() => setExpandedDeliveryId(isSelected ? null : delivery.id)}
                        >
                          <div className="p-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${isSelected ? 'bg-teal-500 text-white' : 'bg-gray-100'}`}>
                                  <FileText className="w-5 h-5" />
                                </div>
                                <div>
                                  <p className="font-mono font-bold">{delivery.barcode}</p>
                                  <div className="flex items-center gap-2 text-sm text-gray-500">
                                    <Building2 className="w-3 h-3" />
                                    <span>{delivery.tenant?.name}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-xs text-gray-500">{formatDate(delivery.labelPrintedAt || delivery.createdAt)}</p>
                                <div className="mt-1">{getStatusBadge(delivery.status)}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Preview Panel - Right Side */}
                <div className="bg-gray-100 rounded-xl p-6 sticky top-0">
                  {!expandedDeliveryId ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 py-20">
                      <FileText className="w-20 h-20 mb-4" />
                      <p className="text-lg">Onizleme icin bir irsaliye secin</p>
                    </div>
                  ) : (
                    (() => {
                      const selectedDelivery = filteredDeliveries.find(d => d.id === expandedDeliveryId);
                      if (!selectedDelivery) return null;
                      const itemTotals = getItemTotals(selectedDelivery);

                      return (
                        <div className="space-y-4">
                          {/* Document Preview */}
                          <div className="bg-white rounded-lg shadow-lg p-6 border" style={{ fontFamily: 'serif' }}>
                            {/* Document Header */}
                            <div className="flex justify-between items-start mb-4 pb-2 border-b-2 border-gray-800">
                              <div>
                                <p className="text-xs text-gray-500">Sayin:</p>
                                <p className="text-lg font-bold">{selectedDelivery.tenant?.name}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-lg font-bold">TEMIZ IRSALIYESI</p>
                              </div>
                            </div>

                            {/* Document Info */}
                            <div className="flex justify-between text-sm mb-4">
                              <div>
                                <p className="text-gray-500">Belge No:</p>
                                <p className="font-mono font-bold">A-{selectedDelivery.barcode.slice(-9)}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-gray-500">Tarih:</p>
                                <p className="font-medium">{new Date(selectedDelivery.labelPrintedAt || selectedDelivery.createdAt).toLocaleDateString('tr-TR')}</p>
                              </div>
                            </div>

                            {/* Items Table */}
                            <div className="border-t border-b border-gray-300 py-2 mb-4">
                              <div className="flex justify-between font-bold text-sm border-b border-gray-200 pb-1 mb-2">
                                <span>CINSI</span>
                                <span>MIKTARI</span>
                              </div>
                              {itemTotals.map((item, idx) => (
                                <div key={idx} className="flex justify-between text-sm py-1">
                                  <span>{item.name.toUpperCase()}</span>
                                  <span className="font-bold">{item.count} adet</span>
                                </div>
                              ))}
                            </div>

                            {/* Totals */}
                            <div className="space-y-2 mb-4">
                              <div className="flex justify-between font-bold text-lg">
                                <span>PAKET SAYISI:</span>
                                <span>{selectedDelivery.packageCount || 1}</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span>TOPLAM URUN:</span>
                                <span className="font-bold">{selectedDelivery.deliveryItems?.length || 0}</span>
                              </div>
                            </div>

                            {/* Barcode */}
                            <div className="text-center py-2 bg-gray-50 rounded text-xs text-gray-500 mb-4">
                              Barkod: {selectedDelivery.barcode}
                            </div>

                            {/* Signature Section */}
                            <div className="border-t border-gray-300 pt-4">
                              <div className="flex justify-between">
                                <div className="text-center flex-1">
                                  <p className="text-xs text-gray-500 mb-6">Teslim Eden</p>
                                  <div className="border-t border-gray-400 w-24 mx-auto"></div>
                                </div>
                                <div className="text-center flex-1">
                                  <p className="text-xs text-gray-500 mb-6">Teslim Alan</p>
                                  <div className="border-t border-gray-400 w-24 mx-auto"></div>
                                </div>
                              </div>
                            </div>

                            {/* Footer */}
                            <div className="text-center text-xs text-gray-400 mt-4 pt-2 border-t">
                              RFID Camasirhane Sistemi
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex gap-3">
                            <div className="flex-1 bg-white rounded-lg p-3 shadow flex items-center gap-3">
                              {getStatusBadge(selectedDelivery.status)}
                              <span className="text-sm text-gray-500">
                                {selectedDelivery.status === 'picked_up' ? 'Teslim edildi' : 'Bekliyor'}
                              </span>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReprintIrsaliye(selectedDelivery);
                              }}
                              className="px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium flex items-center gap-2 shadow"
                            >
                              <Printer className="w-5 h-5" />
                              Yazdir
                            </button>
                          </div>
                        </div>
                      );
                    })()
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
