import { jsPDF } from 'jspdf';
import JsBarcode from 'jsbarcode';
import type { Delivery, DeliveryPackage, Tenant } from '../types';
import { isElectron, getPreferredPrinter } from './printer';

// QZ Tray loaded from CDN in index.html (only used as fallback in browser)
declare const qz: any;

// Initialize QZ Tray security (required for unsigned mode)
function setupQZSecurity() {
  if (typeof qz === 'undefined') return;

  qz.security.setCertificatePromise(() => Promise.resolve(""));
  qz.security.setSignaturePromise(() => () => Promise.resolve(""));
}

// Connect to QZ Tray and wait until ready
async function ensureQZConnected(): Promise<boolean> {
  if (typeof qz === 'undefined') {
    console.error('QZ: Library not loaded');
    return false;
  }

  setupQZSecurity();

  // Already active - we're good
  if (qz.websocket.isActive()) {
    console.log('QZ: Already active');
    return true;
  }

  console.log('QZ: Connecting...');

  // Start connection without waiting for promise
  qz.websocket.connect().catch(() => {});

  // Poll for connection to become active
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (qz.websocket.isActive()) {
      console.log('QZ: Connection active after', (i + 1) * 200, 'ms');
      return true;
    }
  }

  console.error('QZ: Connection failed after 10 seconds');
  return false;
}


// Hardcoded printer name - change this if your printer has a different name
const PRINTER_NAME = 'Argox OS-214 plus series PPLA';

// Helper: wrap promise with timeout
function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
  ]);
}

// Silent print using Electron API (preferred when available)
async function silentPrintElectron(doc: jsPDF): Promise<boolean> {
  if (!isElectron() || !window.electronAPI) {
    return false;
  }

  console.log('silentPrint: Using Electron API...');

  // Get PDF as base64
  const pdfBase64 = doc.output('datauristring');

  // Create HTML wrapper for the PDF
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        @page { size: 60mm 80mm; margin: 0; }
        body { margin: 0; padding: 0; }
        embed { width: 100%; height: 100%; }
      </style>
    </head>
    <body>
      <embed src="${pdfBase64}" type="application/pdf" />
    </body>
    </html>
  `;

  const printerName = getPreferredPrinter() || PRINTER_NAME;

  try {
    const result = await window.electronAPI.printLabel(html, printerName, 1);
    if (result.success) {
      console.log('silentPrint: Electron print SUCCESS!');
      return true;
    } else {
      console.error('silentPrint: Electron print failed:', result.error);
      return false;
    }
  } catch (err: any) {
    console.error('silentPrint: Electron error:', err?.message || err);
    return false;
  }
}

// Silent print using QZ Tray (fallback for browser)
async function silentPrintQZ(doc: jsPDF): Promise<boolean> {
  console.log('silentPrint: Trying QZ Tray...');

  const connected = await ensureQZConnected();
  if (!connected) {
    console.log('silentPrint: Not connected to QZ Tray');
    return false;
  }

  const printer = PRINTER_NAME;
  console.log('silentPrint: Using printer:', printer);

  // Get PDF data
  const pdfDataUri = doc.output('datauristring');
  console.log('silentPrint: PDF ready, length:', pdfDataUri.length);

  // Try pixel/pdf approach with timeout
  try {
    console.log('silentPrint: Creating config...');
    const config = qz.configs.create(printer);

    console.log('silentPrint: Sending to printer...');
    await withTimeout(
      qz.print(config, [{
        type: 'pixel',
        format: 'pdf',
        data: pdfDataUri
      }]),
      15000,
      'Print timeout after 15 seconds'
    );

    console.log('silentPrint: QZ SUCCESS!');
    return true;
  } catch (err: any) {
    console.error('silentPrint: QZ Failed:', err?.message || err);
    return false;
  }
}

// Fallback: download PDF
function downloadPDF(doc: jsPDF): void {
  console.log('downloadPDF: Downloading...');
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `etiket-${Date.now()}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Main print function - try Electron first, then QZ Tray, then download
async function printLabel(doc: jsPDF): Promise<void> {
  // Try Electron API first (if running in desktop app)
  if (isElectron()) {
    const electronSuccess = await silentPrintElectron(doc);
    if (electronSuccess) return;
    console.log('printLabel: Electron print failed, falling back...');
  }

  // Try QZ Tray (browser with QZ Tray installed)
  const qzSuccess = await silentPrintQZ(doc);
  if (qzSuccess) return;

  // Last resort: download PDF
  console.log('printLabel: All print methods failed, downloading PDF');
  downloadPDF(doc);
}


// Label size: 60mm x 80mm
const LABEL_WIDTH = 60;
const LABEL_HEIGHT = 80;

// Type for extra label data (discard/hasarli counts)
export interface LabelExtraItem {
  typeId: string;
  typeName?: string;
  count?: number;
  discardCount: number;
  hasarliCount: number;
}

// Type for manual label generation (without backend delivery)
export interface ManualLabelData {
  tenant: Tenant;
  items: Array<{
    typeName: string;
    count: number;
    discardCount: number;
    hasarliCount: number;
  }>;
  packageCount: number;
}

export function generateDeliveryLabel(delivery: Delivery, labelExtraData?: LabelExtraItem[]) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [LABEL_WIDTH, LABEL_HEIGHT]
  });

  const packages = delivery.deliveryPackages || [];

  // If no packages exist, create labels based on packageCount
  const labelsToGenerate = packages.length > 0
    ? packages
    : Array.from({ length: delivery.packageCount || 1 }, (_, i) => ({
        id: `temp-${i}`,
        deliveryId: delivery.id,
        packageBarcode: `${delivery.barcode}-PKG${i + 1}`,
        sequenceNumber: i + 1,
        status: 'created' as const,
        scannedAt: null,
        scannedBy: null,
        pickedUpAt: null,
        createdAt: new Date().toISOString(),
      } as DeliveryPackage));

  // Check if there's any discord or lekeli in the extra data
  let hasDiscord = false;
  let hasLekeli = false;
  if (labelExtraData) {
    labelExtraData.forEach(e => {
      if (e.discardCount > 0) hasDiscord = true;
      if (e.hasarliCount > 0) hasLekeli = true;
    });
  }

  labelsToGenerate.forEach((pkg, index) => {
    if (index > 0) {
      doc.addPage([LABEL_WIDTH, LABEL_HEIGHT]);
    }

    generateSingleLabel(doc, delivery, pkg, labelsToGenerate.length, labelExtraData);
  });

  // If discord or lekeli is selected, add a second special label
  if (hasDiscord || hasLekeli) {
    doc.addPage([LABEL_WIDTH, LABEL_HEIGHT]);
    generateSpecialLabel(doc, delivery, hasDiscord ? 'DISCORD' : 'LEKELI');
  }

  // Generate filename
  const filename = `delivery-${delivery.barcode}-${Date.now()}.pdf`;

  // Print label (silent print with QZ Tray, fallback to download)
  printLabel(doc);

  return filename;
}

// Generate a special label with big text for DISCORD or LEKELI
function generateSpecialLabel(doc: jsPDF, delivery: Delivery, labelType: 'DISCORD' | 'LEKELI') {
  const black = '#000000';
  const white = '#FFFFFF';
  const margin = 3;

  // White background
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, LABEL_WIDTH, LABEL_HEIGHT, 'F');

  // Colored header bar based on type
  if (labelType === 'DISCORD') {
    doc.setFillColor(59, 130, 246); // Blue
  } else {
    doc.setFillColor(239, 68, 68); // Red
  }
  doc.rect(0, 0, LABEL_WIDTH, 12, 'F');

  // Title in white
  doc.setTextColor(white);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('SPECIAL LABEL', LABEL_WIDTH / 2, 7, { align: 'center' });

  // Reset to black text
  doc.setTextColor(black);

  let yPos = 18;

  // Hotel Name
  doc.setFontSize(5);
  doc.setFont('helvetica', 'normal');
  doc.text('HOTEL', margin, yPos);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  const hotelName = delivery.tenant?.name || 'Unknown Hotel';
  const maxHotelLen = 18;
  const displayHotel = hotelName.length > maxHotelLen ? hotelName.substring(0, maxHotelLen) + '...' : hotelName;
  doc.text(displayHotel, margin, yPos + 4);

  yPos += 12;

  // Big label type text - center of the label
  const bigTextY = LABEL_HEIGHT / 2;

  // Draw a big colored box for the label type
  if (labelType === 'DISCORD') {
    doc.setFillColor(59, 130, 246); // Blue
  } else {
    doc.setFillColor(239, 68, 68); // Red
  }
  doc.rect(margin, bigTextY - 12, LABEL_WIDTH - (margin * 2), 24, 'F');

  // Big text in white
  doc.setTextColor(white);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text(labelType, LABEL_WIDTH / 2, bigTextY + 4, { align: 'center' });

  // Reset to black text
  doc.setTextColor(black);

  // Barcode at the bottom
  const barcodeY = LABEL_HEIGHT - 25;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.2);
  doc.rect(margin, barcodeY, LABEL_WIDTH - (margin * 2), 15, 'S');

  // Draw barcode
  drawBarcode(doc, delivery.barcode, margin + 2, barcodeY + 2, LABEL_WIDTH - (margin * 2) - 4, 8);

  // Barcode text
  doc.setFontSize(6);
  doc.setFont('courier', 'bold');
  doc.text(delivery.barcode, LABEL_WIDTH / 2, barcodeY + 13, { align: 'center' });

  // Date at the very bottom
  doc.setFontSize(5);
  doc.setFont('helvetica', 'normal');
  const date = new Date(delivery.createdAt || Date.now()).toLocaleDateString('tr-TR');
  doc.text(`Tarih: ${date}`, margin, LABEL_HEIGHT - 3);
}

// Generate a real CODE128 barcode using JsBarcode
function drawBarcode(doc: jsPDF, code: string, x: number, y: number, width: number, height: number) {
  // Create a canvas element to render the barcode
  const canvas = document.createElement('canvas');

  try {
    JsBarcode(canvas, code, {
      format: 'CODE128',
      width: 1.5,
      height: Math.round(height * 3), // Scale up for better quality
      displayValue: false, // We'll add text separately
      margin: 0,
    });

    // Add barcode image to PDF
    const barcodeDataUrl = canvas.toDataURL('image/png');
    doc.addImage(barcodeDataUrl, 'PNG', x, y, width, height);
  } catch (error) {
    // Fallback: just draw a rectangle with text if barcode generation fails
    console.error('Barcode generation failed:', error);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.2);
    doc.rect(x, y, width, height, 'S');
  }
}

function generateSingleLabel(
  doc: jsPDF,
  delivery: Delivery,
  pkg: DeliveryPackage,
  totalPackages: number,
  labelExtraData?: LabelExtraItem[]
) {
  // All black and white - no colors
  const black = '#000000';
  const white = '#FFFFFF';
  const margin = 3;

  // White background
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, LABEL_WIDTH, LABEL_HEIGHT, 'F');

  let yPos = 3;

  // ============================================
  // 1. HOTEL NAME - BIG at the top
  // ============================================
  const hotelName = delivery.tenant?.name || 'Unknown Hotel';
  doc.setTextColor(black);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');

  // Center the hotel name
  const maxHotelLen = 22;
  const displayHotel = hotelName.length > maxHotelLen ? hotelName.substring(0, maxHotelLen) + '..' : hotelName;
  doc.text(displayHotel, LABEL_WIDTH / 2, yPos + 5, { align: 'center' });

  // Package count on right side
  doc.setFontSize(8);
  doc.text(`${pkg.sequenceNumber}/${totalPackages}`, LABEL_WIDTH - margin, yPos + 5, { align: 'right' });

  yPos += 12;

  // Thin separator line
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.line(margin, yPos, LABEL_WIDTH - margin, yPos);

  yPos += 3;

  // ============================================
  // 2. BARCODE - below hotel name
  // ============================================
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.2);
  doc.rect(margin, yPos, LABEL_WIDTH - (margin * 2), 18, 'S');

  // Draw barcode
  drawBarcode(doc, pkg.packageBarcode, margin + 2, yPos + 2, LABEL_WIDTH - (margin * 2) - 4, 10);

  // Barcode text
  doc.setFontSize(7);
  doc.setFont('courier', 'bold');
  doc.text(pkg.packageBarcode, LABEL_WIDTH / 2, yPos + 15, { align: 'center' });

  yPos += 21;

  // ============================================
  // 3. ITEMS - 3 column layout if needed
  // ============================================

  // Group items by type - use labelExtraData counts if provided (user-entered), otherwise count actual items
  const itemsByType: Record<string, { name: string; count: number; typeId: string; discardCount: number; hasarliCount: number }> = {};

  // First, if we have labelExtraData with counts, use those (user-entered values)
  if (labelExtraData && labelExtraData.length > 0) {
    labelExtraData.forEach((extraData) => {
      // Get the type name from delivery items or use the typeName from extraData
      let typeName = extraData.typeName || 'Unknown';

      // Try to find the type name from delivery items if not provided
      if (!extraData.typeName && delivery.deliveryItems && delivery.deliveryItems.length > 0) {
        const matchingItem = delivery.deliveryItems.find((di: any) =>
          di.item?.itemTypeId === extraData.typeId
        );
        if (matchingItem) {
          typeName = matchingItem.item?.itemType?.name || 'Unknown';
        }
      }

      // Use the count from extraData if provided, otherwise count from items
      const itemCount = extraData.count || delivery.deliveryItems?.filter((di: any) =>
        di.item?.itemTypeId === extraData.typeId
      ).length || 0;

      itemsByType[extraData.typeId] = {
        name: typeName,
        count: itemCount,
        typeId: extraData.typeId,
        discardCount: extraData.discardCount || 0,
        hasarliCount: extraData.hasarliCount || 0
      };
    });
  } else if (delivery.deliveryItems && delivery.deliveryItems.length > 0) {
    // Fall back to counting actual items if no labelExtraData
    delivery.deliveryItems.forEach((di: any) => {
      const item = di.item;
      const typeName = item?.itemType?.name || 'Unknown';
      const typeId = item?.itemTypeId || 'unknown';

      if (!itemsByType[typeId]) {
        itemsByType[typeId] = { name: typeName, count: 0, typeId, discardCount: 0, hasarliCount: 0 };
      }
      itemsByType[typeId].count++;
    });
  }

  const itemTypeEntries = Object.entries(itemsByType);
  const totalItems = itemTypeEntries.reduce((sum, [, item]) => sum + item.count, 0);

  // Calculate total discard and hasarli counts
  let totalDiscard = 0;
  let totalHasarli = 0;
  itemTypeEntries.forEach(([, item]) => {
    totalDiscard += item.discardCount;
    totalHasarli += item.hasarliCount;
  });

  // Items section header with total
  doc.setFillColor(0, 0, 0);
  doc.rect(margin, yPos, LABEL_WIDTH - (margin * 2), 6, 'F');
  doc.setTextColor(white);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text(`TOPLAM: ${totalItems} ADET`, LABEL_WIDTH / 2, yPos + 4, { align: 'center' });
  doc.setTextColor(black);

  yPos += 9;

  // Display items - 3 column layout if more than 3 items
  if (itemTypeEntries.length > 0) {
    const useThreeColumns = itemTypeEntries.length > 3;
    const colWidth = useThreeColumns ? (LABEL_WIDTH - margin * 2) / 3 : LABEL_WIDTH - margin * 2;

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');

    if (useThreeColumns) {
      // 3-column layout
      itemTypeEntries.forEach(([_typeId, itemType], index) => {
        const col = index % 3;
        const row = Math.floor(index / 3);
        const xPos = margin + (col * colWidth);
        const itemYPos = yPos + (row * 10);

        // Truncate name for column
        const maxNameLen = 8;
        const displayName = itemType.name.length > maxNameLen
          ? itemType.name.substring(0, maxNameLen) + '..'
          : itemType.name;

        // Count (bold)
        doc.setFont('helvetica', 'bold');
        doc.text(`${itemType.count}`, xPos + colWidth / 2, itemYPos, { align: 'center' });

        // Type name (smaller, below)
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5);
        doc.text(displayName, xPos + colWidth / 2, itemYPos + 4, { align: 'center' });
        doc.setFontSize(7);
      });

      // Update yPos based on rows
      const rows = Math.ceil(itemTypeEntries.length / 3);
      yPos += rows * 10 + 2;
    } else {
      // Single column layout for 3 or fewer items
      itemTypeEntries.forEach(([_typeId, itemType]) => {
        const maxNameLen = 20;
        const displayName = itemType.name.length > maxNameLen
          ? itemType.name.substring(0, maxNameLen) + '..'
          : itemType.name;

        doc.setFont('helvetica', 'normal');
        doc.text(displayName, margin, yPos);
        doc.setFont('helvetica', 'bold');
        doc.text(`${itemType.count} adet`, LABEL_WIDTH - margin, yPos, { align: 'right' });
        yPos += 5;
      });
      yPos += 2;
    }
  }

  // Show discord/lekeli totals if any
  if (totalDiscard > 0 || totalHasarli > 0) {
    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    if (totalDiscard > 0) {
      doc.text(`Discord: ${totalDiscard}`, margin, yPos);
    }
    if (totalHasarli > 0) {
      doc.text(`Lekeli: ${totalHasarli}`, totalDiscard > 0 ? LABEL_WIDTH / 2 : margin, yPos);
    }
    yPos += 4;
  }
  // Date at the bottom
  doc.setFontSize(5);
  doc.setFont('helvetica', 'normal');
  const date = new Date(delivery.createdAt || Date.now()).toLocaleDateString('tr-TR');
  doc.text(`Tarih: ${date}`, margin, LABEL_HEIGHT - 8);

  // Footer line
  const footerY = LABEL_HEIGHT - 5;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.1);
  doc.line(margin, footerY, LABEL_WIDTH - margin, footerY);

  // Footer text
  doc.setFontSize(4);
  doc.text('RFID Laundry System', LABEL_WIDTH / 2, footerY + 3, { align: 'center' });
}

// Generate a manual label without backend delivery (for cases with no available items)
export function generateManualLabel(data: ManualLabelData) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [LABEL_WIDTH, LABEL_HEIGHT]
  });

  // Generate a unique barcode based on timestamp
  const timestamp = Date.now().toString(36).toUpperCase();
  const barcode = `M${timestamp}`;

  // Check if there's any discord or lekeli in the data
  let hasDiscord = false;
  let hasLekeli = false;
  data.items.forEach(item => {
    if (item.discardCount > 0) hasDiscord = true;
    if (item.hasarliCount > 0) hasLekeli = true;
  });

  // Generate labels for each package
  for (let pkgIndex = 0; pkgIndex < data.packageCount; pkgIndex++) {
    if (pkgIndex > 0) {
      doc.addPage([LABEL_WIDTH, LABEL_HEIGHT]);
    }

    generateManualSingleLabel(doc, data, barcode, pkgIndex + 1, data.packageCount);
  }

  // If discord or lekeli is selected, add a special label
  if (hasDiscord || hasLekeli) {
    doc.addPage([LABEL_WIDTH, LABEL_HEIGHT]);
    generateManualSpecialLabel(doc, data.tenant, barcode, hasDiscord ? 'DISCORD' : 'LEKELI');
  }

  // Generate filename
  const filename = `manual-label-${barcode}-${Date.now()}.pdf`;

  // Print label (silent print with QZ Tray, fallback to download)
  printLabel(doc);

  return filename;
}

function generateManualSingleLabel(
  doc: jsPDF,
  data: ManualLabelData,
  barcode: string,
  packageNumber: number,
  totalPackages: number
) {
  const black = '#000000';
  const white = '#FFFFFF';
  const margin = 3;

  // White background
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, LABEL_WIDTH, LABEL_HEIGHT, 'F');

  let yPos = 3;

  // ============================================
  // 1. HOTEL NAME - BIG at the top
  // ============================================
  const hotelName = data.tenant?.name || 'Unknown Hotel';
  doc.setTextColor(black);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');

  // Center the hotel name
  const maxHotelLen = 22;
  const displayHotel = hotelName.length > maxHotelLen ? hotelName.substring(0, maxHotelLen) + '..' : hotelName;
  doc.text(displayHotel, LABEL_WIDTH / 2, yPos + 5, { align: 'center' });

  // Package count on right side
  doc.setFontSize(8);
  doc.text(`${packageNumber}/${totalPackages}`, LABEL_WIDTH - margin, yPos + 5, { align: 'right' });

  yPos += 12;

  // Thin separator line
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.line(margin, yPos, LABEL_WIDTH - margin, yPos);

  yPos += 3;

  // ============================================
  // 2. BARCODE - below hotel name
  // ============================================
  const packageBarcode = `${barcode}-PKG${packageNumber}`;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.2);
  doc.rect(margin, yPos, LABEL_WIDTH - (margin * 2), 18, 'S');

  // Draw barcode
  drawBarcode(doc, packageBarcode, margin + 2, yPos + 2, LABEL_WIDTH - (margin * 2) - 4, 10);

  // Barcode text
  doc.setFontSize(7);
  doc.setFont('courier', 'bold');
  doc.text(packageBarcode, LABEL_WIDTH / 2, yPos + 15, { align: 'center' });

  yPos += 21;

  // ============================================
  // 3. ITEMS - 3 column layout if needed
  // ============================================

  // Calculate totals
  let totalItems = 0;
  let totalDiscard = 0;
  let totalHasarli = 0;
  data.items.forEach((item) => {
    totalItems += item.count;
    totalDiscard += item.discardCount;
    totalHasarli += item.hasarliCount;
  });

  // Items section header with total
  doc.setFillColor(0, 0, 0);
  doc.rect(margin, yPos, LABEL_WIDTH - (margin * 2), 6, 'F');
  doc.setTextColor(white);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text(`TOPLAM: ${totalItems} ADET`, LABEL_WIDTH / 2, yPos + 4, { align: 'center' });
  doc.setTextColor(black);

  yPos += 9;

  // Display items - 3 column layout if more than 3 items
  if (data.items.length > 0) {
    const useThreeColumns = data.items.length > 3;
    const colWidth = useThreeColumns ? (LABEL_WIDTH - margin * 2) / 3 : LABEL_WIDTH - margin * 2;

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');

    if (useThreeColumns) {
      // 3-column layout
      data.items.forEach((item, index) => {
        const col = index % 3;
        const row = Math.floor(index / 3);
        const xPos = margin + (col * colWidth);
        const itemYPos = yPos + (row * 10);

        // Truncate name for column
        const maxNameLen = 8;
        const displayName = item.typeName.length > maxNameLen
          ? item.typeName.substring(0, maxNameLen) + '..'
          : item.typeName;

        // Count (bold)
        doc.setFont('helvetica', 'bold');
        doc.text(`${item.count}`, xPos + colWidth / 2, itemYPos, { align: 'center' });

        // Type name (smaller, below)
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5);
        doc.text(displayName, xPos + colWidth / 2, itemYPos + 4, { align: 'center' });
        doc.setFontSize(7);
      });

      // Update yPos based on rows
      const rows = Math.ceil(data.items.length / 3);
      yPos += rows * 10 + 2;
    } else {
      // Single column layout for 3 or fewer items
      data.items.forEach((item) => {
        const maxNameLen = 20;
        const displayName = item.typeName.length > maxNameLen
          ? item.typeName.substring(0, maxNameLen) + '..'
          : item.typeName;

        doc.setFont('helvetica', 'normal');
        doc.text(displayName, margin, yPos);
        doc.setFont('helvetica', 'bold');
        doc.text(`${item.count} adet`, LABEL_WIDTH - margin, yPos, { align: 'right' });
        yPos += 5;
      });
      yPos += 2;
    }
  }

  // Show discord/lekeli totals if any
  if (totalDiscard > 0 || totalHasarli > 0) {
    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    if (totalDiscard > 0) {
      doc.text(`Discord: ${totalDiscard}`, margin, yPos);
    }
    if (totalHasarli > 0) {
      doc.text(`Lekeli: ${totalHasarli}`, totalDiscard > 0 ? LABEL_WIDTH / 2 : margin, yPos);
    }
    yPos += 4;
  }

  // Date at the bottom
  doc.setFontSize(5);
  doc.setFont('helvetica', 'normal');
  const date = new Date().toLocaleDateString('tr-TR');
  doc.text(`Tarih: ${date}`, margin, LABEL_HEIGHT - 8);

  // Footer line
  const footerY = LABEL_HEIGHT - 5;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.1);
  doc.line(margin, footerY, LABEL_WIDTH - margin, footerY);

  // Footer text
  doc.setFontSize(4);
  doc.text('RFID Laundry System', LABEL_WIDTH / 2, footerY + 3, { align: 'center' });
}

function generateManualSpecialLabel(doc: jsPDF, tenant: Tenant, barcode: string, labelType: 'DISCORD' | 'LEKELI') {
  const black = '#000000';
  const white = '#FFFFFF';
  const margin = 3;

  // White background
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, LABEL_WIDTH, LABEL_HEIGHT, 'F');

  // Colored header bar based on type
  if (labelType === 'DISCORD') {
    doc.setFillColor(59, 130, 246); // Blue
  } else {
    doc.setFillColor(239, 68, 68); // Red
  }
  doc.rect(0, 0, LABEL_WIDTH, 12, 'F');

  // Title in white
  doc.setTextColor(white);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('SPECIAL LABEL', LABEL_WIDTH / 2, 7, { align: 'center' });

  // Reset to black text
  doc.setTextColor(black);

  let yPos = 18;

  // Hotel Name
  doc.setFontSize(5);
  doc.setFont('helvetica', 'normal');
  doc.text('HOTEL', margin, yPos);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  const hotelName = tenant?.name || 'Unknown Hotel';
  const maxHotelLen = 18;
  const displayHotel = hotelName.length > maxHotelLen ? hotelName.substring(0, maxHotelLen) + '...' : hotelName;
  doc.text(displayHotel, margin, yPos + 4);

  yPos = Math.max(yPos, 30) + 12;

  // Big label type text - center of the label
  const bigTextY = LABEL_HEIGHT / 2;

  // Draw a big colored box for the label type
  if (labelType === 'DISCORD') {
    doc.setFillColor(59, 130, 246); // Blue
  } else {
    doc.setFillColor(239, 68, 68); // Red
  }
  doc.rect(margin, bigTextY - 12, LABEL_WIDTH - (margin * 2), 24, 'F');

  // Big text in white
  doc.setTextColor(white);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text(labelType, LABEL_WIDTH / 2, bigTextY + 4, { align: 'center' });

  // Reset to black text
  doc.setTextColor(black);

  // Barcode at the bottom
  const barcodeY = LABEL_HEIGHT - 25;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.2);
  doc.rect(margin, barcodeY, LABEL_WIDTH - (margin * 2), 15, 'S');

  // Draw barcode
  drawBarcode(doc, barcode, margin + 2, barcodeY + 2, LABEL_WIDTH - (margin * 2) - 4, 8);

  // Barcode text
  doc.setFontSize(6);
  doc.setFont('courier', 'bold');
  doc.text(barcode, LABEL_WIDTH / 2, barcodeY + 13, { align: 'center' });

  // Date at the very bottom
  doc.setFontSize(5);
  doc.setFont('helvetica', 'normal');
  const date = new Date().toLocaleDateString('tr-TR');
  doc.text(`Tarih: ${date}`, margin, LABEL_HEIGHT - 3);
}
