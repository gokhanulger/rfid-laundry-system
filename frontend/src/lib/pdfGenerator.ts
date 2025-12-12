import { jsPDF } from 'jspdf';
import JsBarcode from 'jsbarcode';
import type { Delivery, Tenant } from '../types';
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

// Store label data for Electron printing
let pendingLabelData: { delivery: any; labelExtraData?: LabelExtraItem[] } | null = null;

export function setPendingLabelData(delivery: any, labelExtraData?: LabelExtraItem[]) {
  pendingLabelData = { delivery, labelExtraData };
}

// Generate barcode as base64 image
function generateBarcodeBase64(code: string): string {
  const canvas = document.createElement('canvas');
  try {
    JsBarcode(canvas, code, {
      format: 'CODE128',
      width: 2,
      height: 50,
      displayValue: false,
      margin: 0,
    });
    return canvas.toDataURL('image/png');
  } catch (error) {
    console.error('Barcode generation failed:', error);
    return '';
  }
}

// Generate a numeric barcode code (8 digits - only numbers)
function generateShortCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
}

// Generate HTML label for Electron printing (no PDF)
// Label size: 60mm width x 80mm height (portrait - taller than wide)
function generateHtmlLabel(delivery: any, labelExtraData?: LabelExtraItem[]): string {
  // Group items by type
  const itemsByType: Record<string, { name: string; count: number; discardCount: number; hasarliCount: number }> = {};

  if (labelExtraData && labelExtraData.length > 0) {
    labelExtraData.forEach((extraData) => {
      itemsByType[extraData.typeId] = {
        name: extraData.typeName || 'Unknown',
        count: extraData.count || 0,
        discardCount: extraData.discardCount || 0,
        hasarliCount: extraData.hasarliCount || 0
      };
    });
  }

  const itemTypeEntries = Object.entries(itemsByType);
  // Hotel name in ALL CAPS
  const hotelName = (delivery.tenant?.name || 'UNKNOWN HOTEL').toUpperCase();
  const date = new Date(delivery.createdAt || Date.now()).toLocaleDateString('tr-TR');

  // Check for discord/lekeli
  let hasDiscord = false;
  let hasLekeli = false;
  itemTypeEntries.forEach(([, item]) => {
    if (item.discardCount > 0) hasDiscord = true;
    if (item.hasarliCount > 0) hasLekeli = true;
  });

  // Pagination: max 3 items per label (if more than 3, use 2nd label)
  const ITEMS_PER_LABEL = 3;
  const totalLabels = Math.max(1, Math.ceil(itemTypeEntries.length / ITEMS_PER_LABEL));

  // Use delivery barcode for scanning compatibility
  const shortCode = delivery.barcode || generateShortCode();

  // Generate HTML for each label
  let labelsHtml = '';

  for (let labelIndex = 0; labelIndex < totalLabels; labelIndex++) {
    const startIdx = labelIndex * ITEMS_PER_LABEL;
    const endIdx = Math.min(startIdx + ITEMS_PER_LABEL, itemTypeEntries.length);
    const itemsForThisLabel = itemTypeEntries.slice(startIdx, endIdx);
    const isFirstLabel = labelIndex === 0;

    // Generate barcode image only for first label
    const barcodeImg = isFirstLabel ? generateBarcodeBase64(shortCode) : null;

    if (labelIndex > 0) {
      labelsHtml += '<div class="page-break"></div>';
    }

    if (isFirstLabel) {
      // FIRST LABEL: Hotel name (ALL CAPS) + Date + Barcode + Items
      labelsHtml += `
        <div class="label">
          <div class="hotel-name">${hotelName}</div>
          <div class="date">${date}</div>
          ${totalLabels > 1 ? `<div class="pagination">${labelIndex + 1}/${totalLabels}</div>` : ''}
          <div class="separator"></div>
          <div class="barcode-area">
            ${barcodeImg ? `<img src="${barcodeImg}" class="barcode-img" />` : ''}
            <div class="barcode-text">${shortCode}</div>
          </div>
          <div class="items-list">
            ${itemsForThisLabel.map(([, item]) => `
              <div class="item-row">
                <span class="item-count">${item.count} adet</span> ${item.name}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      // CONTINUATION LABELS: Only items list (no hotel name, no barcode)
      labelsHtml += `
        <div class="label">
          <div class="continuation-header">Devam ${labelIndex + 1}/${totalLabels}</div>
          <div class="separator-light"></div>
          <div class="items-list">
            ${itemsForThisLabel.map(([, item]) => `
              <div class="item-row">
                <span class="item-count">${item.count} adet</span> ${item.name}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }
  }

  // Add special label if discord or lekeli (NO barcode, just warning text)
  if (hasDiscord || hasLekeli) {
    const labelText = hasDiscord
      ? 'DISCART URUN BU URUNU LUTFEN BIR DAHA KULLANMAYINIZ'
      : 'LEKELI URUN LUTFEN KULLANMAYINIZ';
    const colorClass = hasDiscord ? 'warning-blue' : 'warning-red';

    labelsHtml += `
      <div class="page-break"></div>
      <div class="label warning-label">
        <div class="warning-hotel">${hotelName}</div>
        <div class="warning-date">${date}</div>
        <div class="warning-box ${colorClass}">
          <div class="warning-text">${labelText}</div>
        </div>
      </div>
    `;
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        @page {
          size: 60mm 80mm;
          margin: 0;
        }
        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: 60mm;
          }
          .page-break {
            page-break-before: always;
            height: 0;
            margin: 0;
            padding: 0;
          }
        }
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        html, body {
          margin: 0;
          padding: 0;
          font-family: Arial, sans-serif;
          width: 60mm;
        }
        .label {
          width: 60mm;
          height: 80mm;
          padding: 2mm;
          position: relative;
          overflow: hidden;
        }
        .hotel-name {
          text-align: center;
          font-size: 22pt;
          font-weight: bold;
          margin-bottom: 1mm;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .date {
          text-align: center;
          font-size: 11pt;
          color: #000;
          margin-bottom: 2mm;
        }
        .pagination {
          position: absolute;
          top: 1mm;
          right: 2mm;
          font-size: 8pt;
          font-weight: bold;
        }
        .separator {
          border-bottom: 2px solid black;
          margin: 0 0 2mm 0;
        }
        .separator-light {
          border-bottom: 2px solid #ccc;
          margin: 0 0 2mm 0;
        }
        .barcode-area {
          text-align: center;
          margin-bottom: 2mm;
        }
        .barcode-img {
          width: 54mm;
          height: 10mm;
          display: block;
          margin: 0 auto;
        }
        .barcode-text {
          font-family: Courier, monospace;
          font-size: 12pt;
          font-weight: bold;
          color: #333;
          letter-spacing: 2px;
          margin-top: 1mm;
        }
        .items-list {
          margin-top: 2mm;
        }
        .item-row {
          font-size: 13pt;
          padding: 1mm 0;
          border-bottom: 1px dotted #ccc;
        }
        .item-count {
          font-weight: bold;
        }
        .continuation-header {
          text-align: center;
          font-size: 12pt;
          font-weight: bold;
          margin-bottom: 2mm;
          color: #666;
        }
        .warning-label {
          padding: 0 2mm;
        }
        .warning-hotel {
          text-align: center;
          font-size: 12pt;
          font-weight: bold;
          margin: 0;
          padding-top: 1mm;
        }
        .warning-date {
          text-align: center;
          font-size: 8pt;
          margin: 0;
        }
        .warning-box {
          text-align: center;
          padding: 8mm 2mm;
          border: 3px solid;
          margin: 0 1mm;
        }
        .warning-box.warning-blue {
          border-color: #3B82F6;
        }
        .warning-box.warning-red {
          border-color: #EF4444;
        }
        .warning-text {
          font-size: 14pt;
          font-weight: bold;
          line-height: 1.3;
        }
        .warning-blue .warning-text {
          color: #3B82F6;
        }
        .warning-red .warning-text {
          color: #EF4444;
        }
        .page-break {
          page-break-before: always;
          height: 0;
        }
      </style>
    </head>
    <body>
      ${labelsHtml}
    </body>
    </html>
  `;
}

// Silent print using Electron API (preferred when available)
async function silentPrintElectron(doc: jsPDF): Promise<boolean> {
  if (!isElectron() || !window.electronAPI) {
    return false;
  }

  console.log('silentPrint: Using Electron API...');

  // If we have pending label data, generate HTML directly (no PDF embed)
  let html: string;
  if (pendingLabelData) {
    html = generateHtmlLabel(pendingLabelData.delivery, pendingLabelData.labelExtraData);
    pendingLabelData = null; // Clear after use
  } else {
    // Fallback: Create simple HTML from PDF (may not work well)
    const pdfBase64 = doc.output('datauristring');
    html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          @page { size: 60mm 80mm; margin: 0; }
          body { margin: 0; padding: 0; }
          iframe { width: 100%; height: 100%; border: none; }
        </style>
      </head>
      <body>
        <iframe src="${pdfBase64}"></iframe>
      </body>
      </html>
    `;
  }

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


// Label size: 60mm x 80mm (portrait - taller than wide)
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

// Max items per label before pagination
const MAX_ITEMS_PER_LABEL = 3;

export function generateDeliveryLabel(delivery: Delivery, labelExtraData?: LabelExtraItem[]) {
  // Store data for Electron HTML generation
  if (isElectron()) {
    setPendingLabelData(delivery, labelExtraData);
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [LABEL_WIDTH, LABEL_HEIGHT]
  });

  // Check if there's any discord or lekeli in the extra data
  let hasDiscord = false;
  let hasLekeli = false;
  if (labelExtraData) {
    labelExtraData.forEach(e => {
      if (e.discardCount > 0) hasDiscord = true;
      if (e.hasarliCount > 0) hasLekeli = true;
    });
  }

  // Calculate total item types for pagination
  const itemTypeCount = labelExtraData?.length || 0;
  const totalContentLabels = Math.max(1, Math.ceil(itemTypeCount / MAX_ITEMS_PER_LABEL));

  // Generate content labels with pagination
  let pageIndex = 0;
  for (let labelIdx = 0; labelIdx < totalContentLabels; labelIdx++) {
    if (pageIndex > 0) {
      doc.addPage([LABEL_WIDTH, LABEL_HEIGHT]);
    }

    // Slice items for this label
    const startIdx = labelIdx * MAX_ITEMS_PER_LABEL;
    const endIdx = Math.min(startIdx + MAX_ITEMS_PER_LABEL, itemTypeCount);
    const itemsForThisLabel = labelExtraData?.slice(startIdx, endIdx);

    generateSingleLabel(doc, delivery, labelIdx + 1, totalContentLabels, itemsForThisLabel);
    pageIndex++;
  }

  // If discord or lekeli is selected, add a second special label
  if (hasDiscord || hasLekeli) {
    doc.addPage([LABEL_WIDTH, LABEL_HEIGHT]);
    generateSpecialLabel(doc, delivery, hasDiscord
      ? 'DISCART URUN BU URUNU LUTFEN BIR DAHA KULLANMAYINIZ'
      : 'LEKELI URUN LUTFEN KULLANMAYINIZ');
  }

  // Generate filename
  const filename = `delivery-${delivery.barcode}-${Date.now()}.pdf`;

  // Print label (silent print with QZ Tray, fallback to download)
  printLabel(doc);

  return filename;
}

// Generate a special label with warning text (NO barcode)
function generateSpecialLabel(doc: jsPDF, delivery: Delivery, labelText: string) {
  const black = '#000000';
  const margin = 3;

  // White background
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, LABEL_WIDTH, LABEL_HEIGHT, 'F');

  // Determine color based on type
  const isDiscart = labelText.includes('DISCART');
  const textColor = isDiscart ? [59, 130, 246] : [239, 68, 68]; // Blue or Red

  let yPos = 3;

  // Hotel Name at top - ALL CAPS
  const hotelName = (delivery.tenant?.name || 'UNKNOWN HOTEL').toUpperCase();
  doc.setTextColor(black);
  doc.setFont('helvetica', 'bold');

  // Auto-size font to fit hotel name
  let fontSize = 16;
  doc.setFontSize(fontSize);
  let textWidth = doc.getTextWidth(hotelName);
  const maxWidth = LABEL_WIDTH - (margin * 2);

  while (textWidth > maxWidth && fontSize > 10) {
    fontSize -= 1;
    doc.setFontSize(fontSize);
    textWidth = doc.getTextWidth(hotelName);
  }

  doc.text(hotelName, LABEL_WIDTH / 2, yPos + 5, { align: 'center' });

  yPos += 8;

  // Date below hotel name
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const date = new Date(delivery.createdAt || Date.now()).toLocaleDateString('tr-TR');
  doc.text(date, LABEL_WIDTH / 2, yPos + 3, { align: 'center' });

  yPos += 8;

  // Separator line
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.line(margin, yPos, LABEL_WIDTH - margin, yPos);

  yPos += 8;

  // Warning text box (with border, no fill, NO BARCODE)
  const boxY = yPos;
  const boxHeight = 35;

  // Draw border only (no fill)
  doc.setDrawColor(textColor[0], textColor[1], textColor[2]);
  doc.setLineWidth(1);
  doc.rect(margin + 2, boxY, LABEL_WIDTH - (margin * 2) - 4, boxHeight, 'S');

  // Warning text in color - split into lines
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');

  // Split text to fit in box
  const textMaxWidth = LABEL_WIDTH - (margin * 2) - 10;
  const lines = doc.splitTextToSize(labelText, textMaxWidth);
  const lineHeight = 5;
  const textStartY = boxY + (boxHeight - lines.length * lineHeight) / 2 + lineHeight;

  lines.forEach((line: string, i: number) => {
    doc.text(line, LABEL_WIDTH / 2, textStartY + i * lineHeight, { align: 'center' });
  });

  // Reset to black text
  doc.setTextColor(black);
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
  labelNumber: number,
  totalLabels: number,
  labelExtraData?: LabelExtraItem[]
) {
  // All black and white - no colors
  const black = '#000000';
  const margin = 3;

  // White background
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, LABEL_WIDTH, LABEL_HEIGHT, 'F');

  let yPos = 3;

  // ============================================
  // 1. HOTEL NAME - ALL CAPS at the top
  // ============================================
  const hotelName = (delivery.tenant?.name || 'UNKNOWN HOTEL').toUpperCase();
  doc.setTextColor(black);
  doc.setFont('helvetica', 'bold');

  // Auto-size font to fit hotel name
  let fontSize = 20;
  doc.setFontSize(fontSize);
  let textWidth = doc.getTextWidth(hotelName);
  const maxWidth = LABEL_WIDTH - (margin * 2);

  // Reduce font size until it fits
  while (textWidth > maxWidth && fontSize > 10) {
    fontSize -= 1;
    doc.setFontSize(fontSize);
    textWidth = doc.getTextWidth(hotelName);
  }

  doc.text(hotelName, LABEL_WIDTH / 2, yPos + 6, { align: 'center' });

  // Label pagination on right side (only if multiple labels)
  if (totalLabels > 1) {
    doc.setFontSize(7);
    doc.text(`${labelNumber}/${totalLabels}`, LABEL_WIDTH - margin, yPos + 3, { align: 'right' });
  }

  yPos += 9;

  // ============================================
  // 2. DATE - TR format right after hotel name
  // ============================================
  const date = new Date(delivery.createdAt || Date.now()).toLocaleDateString('tr-TR');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(date, LABEL_WIDTH / 2, yPos + 3, { align: 'center' });

  yPos += 6;

  // Thin separator line
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.line(margin, yPos, LABEL_WIDTH - margin, yPos);

  yPos += 3;

  // ============================================
  // 3. BARCODE - use delivery barcode for scanning
  // ============================================
  const shortCode = delivery.barcode || generateShortCode();

  // Draw barcode with delivery barcode
  drawBarcode(doc, shortCode, margin + 2, yPos, LABEL_WIDTH - (margin * 2) - 4, 10);

  // Barcode text - full number, single size
  doc.setTextColor(50, 50, 50);
  doc.setFont('courier', 'bold');
  doc.setFontSize(11);
  doc.text(shortCode, LABEL_WIDTH / 2, yPos + 14, { align: 'center' });
  doc.setTextColor(black);

  yPos += 18;

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

  // Calculate total discard and hasarli counts
  let totalDiscard = 0;
  let totalHasarli = 0;
  itemTypeEntries.forEach(([, item]) => {
    totalDiscard += item.discardCount;
    totalHasarli += item.hasarliCount;
  });

  // Display items - format: "2 adet Çarşaf"
  if (itemTypeEntries.length > 0) {
    doc.setFontSize(10);
    itemTypeEntries.forEach(([_typeId, itemType]) => {
      const maxNameLen = 16;
      const displayName = itemType.name.length > maxNameLen
        ? itemType.name.substring(0, maxNameLen) + '..'
        : itemType.name;

      // Format: "2 adet Çarşaf"
      doc.setFont('helvetica', 'bold');
      doc.text(`${itemType.count} adet`, margin, yPos);
      doc.setFont('helvetica', 'normal');
      const countWidth = doc.getTextWidth(`${itemType.count} adet `);
      doc.text(displayName, margin + countWidth, yPos);
      yPos += 6;
    });
    yPos += 2;
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
  }
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

  // Calculate pagination for items
  const totalContentLabels = Math.max(1, Math.ceil(data.items.length / MAX_ITEMS_PER_LABEL));

  // Generate labels with pagination
  let pageIndex = 0;
  for (let labelIdx = 0; labelIdx < totalContentLabels; labelIdx++) {
    if (pageIndex > 0) {
      doc.addPage([LABEL_WIDTH, LABEL_HEIGHT]);
    }

    // Slice items for this label
    const startIdx = labelIdx * MAX_ITEMS_PER_LABEL;
    const endIdx = Math.min(startIdx + MAX_ITEMS_PER_LABEL, data.items.length);
    const itemsForThisLabel = data.items.slice(startIdx, endIdx);

    generateManualSingleLabel(doc, { ...data, items: itemsForThisLabel }, barcode, labelIdx + 1, totalContentLabels);
    pageIndex++;
  }

  // If discord or lekeli is selected, add a special label
  if (hasDiscord || hasLekeli) {
    doc.addPage([LABEL_WIDTH, LABEL_HEIGHT]);
    generateManualSpecialLabel(doc, data.tenant, hasDiscord
      ? 'DISCART URUN BU URUNU LUTFEN BIR DAHA KULLANMAYINIZ'
      : 'LEKELI URUN LUTFEN KULLANMAYINIZ');
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
  const margin = 3;

  // White background
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, LABEL_WIDTH, LABEL_HEIGHT, 'F');

  let yPos = 3;

  // ============================================
  // 1. HOTEL NAME - ALL CAPS at the top
  // ============================================
  const hotelName = (data.tenant?.name || 'UNKNOWN HOTEL').toUpperCase();
  doc.setTextColor(black);
  doc.setFont('helvetica', 'bold');

  // Auto-size font to fit hotel name
  let fontSize = 20;
  doc.setFontSize(fontSize);
  let textWidth = doc.getTextWidth(hotelName);
  const maxWidth = LABEL_WIDTH - (margin * 2);

  // Reduce font size until it fits
  while (textWidth > maxWidth && fontSize > 10) {
    fontSize -= 1;
    doc.setFontSize(fontSize);
    textWidth = doc.getTextWidth(hotelName);
  }

  doc.text(hotelName, LABEL_WIDTH / 2, yPos + 6, { align: 'center' });

  // Package count on right side (only if multiple)
  if (totalPackages > 1) {
    doc.setFontSize(7);
    doc.text(`${packageNumber}/${totalPackages}`, LABEL_WIDTH - margin, yPos + 3, { align: 'right' });
  }

  yPos += 9;

  // ============================================
  // 2. DATE - TR format right after hotel name
  // ============================================
  const date = new Date().toLocaleDateString('tr-TR');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(date, LABEL_WIDTH / 2, yPos + 3, { align: 'center' });

  yPos += 6;

  // Thin separator line
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.line(margin, yPos, LABEL_WIDTH - margin, yPos);

  yPos += 3;

  // ============================================
  // 3. BARCODE - use provided barcode for scanning
  // ============================================
  const shortCode = barcode || generateShortCode();

  // Draw barcode
  drawBarcode(doc, shortCode, margin + 2, yPos, LABEL_WIDTH - (margin * 2) - 4, 10);

  // Barcode text - full number, single size
  doc.setTextColor(50, 50, 50);
  doc.setFont('courier', 'bold');
  doc.setFontSize(11);
  doc.text(shortCode, LABEL_WIDTH / 2, yPos + 14, { align: 'center' });
  doc.setTextColor(black);

  yPos += 18;

  // ============================================
  // 4. ITEMS
  // ============================================

  // Calculate totals
  let totalDiscard = 0;
  let totalHasarli = 0;
  data.items.forEach((item) => {
    totalDiscard += item.discardCount;
    totalHasarli += item.hasarliCount;
  });

  // Display items - format: "2 adet Çarşaf"
  if (data.items.length > 0) {
    doc.setFontSize(10);
    data.items.forEach((item) => {
      const maxNameLen = 16;
      const displayName = item.typeName.length > maxNameLen
        ? item.typeName.substring(0, maxNameLen) + '..'
        : item.typeName;

      // Format: "2 adet Çarşaf"
      doc.setFont('helvetica', 'bold');
      doc.text(`${item.count} adet`, margin, yPos);
      doc.setFont('helvetica', 'normal');
      const countWidth = doc.getTextWidth(`${item.count} adet `);
      doc.text(displayName, margin + countWidth, yPos);
      yPos += 6;
    });
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
  }
}

function generateManualSpecialLabel(doc: jsPDF, tenant: Tenant, labelText: string) {
  const black = '#000000';
  const margin = 3;

  // White background
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, LABEL_WIDTH, LABEL_HEIGHT, 'F');

  // Determine color based on type
  const isDiscart = labelText.includes('DISCART');
  const textColor = isDiscart ? [59, 130, 246] : [239, 68, 68]; // Blue or Red

  let yPos = 3;

  // Hotel Name at top - ALL CAPS
  const hotelName = (tenant?.name || 'UNKNOWN HOTEL').toUpperCase();
  doc.setTextColor(black);
  doc.setFont('helvetica', 'bold');

  // Auto-size font to fit hotel name
  let fontSize = 16;
  doc.setFontSize(fontSize);
  let textWidth = doc.getTextWidth(hotelName);
  const maxWidth = LABEL_WIDTH - (margin * 2);

  while (textWidth > maxWidth && fontSize > 10) {
    fontSize -= 1;
    doc.setFontSize(fontSize);
    textWidth = doc.getTextWidth(hotelName);
  }

  doc.text(hotelName, LABEL_WIDTH / 2, yPos + 5, { align: 'center' });

  yPos += 8;

  // Date below hotel name
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const date = new Date().toLocaleDateString('tr-TR');
  doc.text(date, LABEL_WIDTH / 2, yPos + 3, { align: 'center' });

  yPos += 8;

  // Separator line
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.line(margin, yPos, LABEL_WIDTH - margin, yPos);

  yPos += 8;

  // Warning text box (with border, no fill, NO BARCODE)
  const boxY = yPos;
  const boxHeight = 35;

  // Draw border only (no fill)
  doc.setDrawColor(textColor[0], textColor[1], textColor[2]);
  doc.setLineWidth(1);
  doc.rect(margin + 2, boxY, LABEL_WIDTH - (margin * 2) - 4, boxHeight, 'S');

  // Warning text in color - split into lines
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');

  // Split text to fit in box
  const textMaxWidth = LABEL_WIDTH - (margin * 2) - 10;
  const lines = doc.splitTextToSize(labelText, textMaxWidth);
  const lineHeight = 5;
  const textStartY = boxY + (boxHeight - lines.length * lineHeight) / 2 + lineHeight;

  lines.forEach((line: string, i: number) => {
    doc.text(line, LABEL_WIDTH / 2, textStartY + i * lineHeight, { align: 'center' });
  });

  // Reset to black text
  doc.setTextColor(black);
}
