import { jsPDF } from 'jspdf';
import JsBarcode from 'jsbarcode';
import qz from 'qz-tray';
import type { Delivery, DeliveryPackage, Tenant } from '../types';

// QZ Tray connection state
let qzConnected = false;
let qzInitialized = false;

// Initialize QZ Tray - set up certificate handling
function initQZ() {
  if (qzInitialized) return;
  qzInitialized = true;

  // Override certificate promise - use demo/unsigned mode
  qz.security.setCertificatePromise(function() {
    return Promise.resolve(
      "-----BEGIN CERTIFICATE-----\n" +
      "MIID1TCCAr2gAwIBAgIUEOWdKdKfL3xuFE7HJv3pDp2x5hQwDQYJKoZIhvcNAQEL\n" +
      "BQAwejELMAkGA1UEBhMCVVMxCzAJBgNVBAgMAk5ZMREwDwYDVQQHDAhOZXcgWW9y\n" +
      "azEPMA0GA1UECgwGUVogTExDMRAwDgYDVQQLDAdRWiBUcmF5MSgwJgYDVQQDDB9E\n" +
      "ZW1vIENlcnRpZmljYXRlIC0gRm9yIFRlc3RpbmcwHhcNMjMwMTAxMDAwMDAwWhcN\n" +
      "MjgwMTAxMDAwMDAwWjB6MQswCQYDVQQGEwJVUzELMAkGA1UECAwCTlkxETAPBgNV\n" +
      "BAcMCE5ldyBZb3JrMQ8wDQYDVQQKDAZRWiBMTEMxEDAOBgNVBAsMB1FaIFRyYXkx\n" +
      "KDAmBgNVBAMMH0RlbW8gQ2VydGlmaWNhdGUgLSBGb3IgVGVzdGluZzCCASIwDQYJ\n" +
      "KoZIhvcNAQEBBQADggEPADCCAQoCggEBALUJT7gQkfZMJlCGLJ5mJ7y/kV2FULWA\n" +
      "yNKdNS9/YIBkhNM+vQfBo0p7hP4wckivUHayujnHfJ7gH6M/gsAvHp8OYCEviJ7R\n" +
      "8OXHZb4rq6qW3T9qVGQBCO58JYu6Zy5rW6sWBODYrFJN/u8PZJu9YXAsR/VPXEKP\n" +
      "8bB0G8GQWrFOt8bQAF0M/rl4GyP5QRgJWE+E5bN8Ghv2YLNv8TPl3ZQX8fSdqJ8t\n" +
      "L7nERmFEcP0q0JiAKyri8N9DwG4J/s4RDl4/ql0qL/HZk5kIkXWMBGPIpqUVTJgF\n" +
      "Jw9QKMV3aR1x6x4IVJuZ6Q9h8DZ8i9JdJHGSYQYGJJHZ2t1lJf8CAwEAAaNTMFEw\n" +
      "HQYDVR0OBBYEFFmU+r7K6F0OlhYNITnCDhYJ4L8MMB8GA1UdIwQYMBaAFFmU+r7K\n" +
      "6F0OlhYNITnCDhYJ4L8MMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQAD\n" +
      "ggEBADMR7y0aZUNPZqMAYApmM5d/5u00xTg0NrbWqW9do1X5MWJD+WEKhQV9L7wJ\n" +
      "T/MgP+/sKzlPKZU4o0JLF/5M88rmPP0bBkD7NWJFWN5j8YRz8QKFJ4u5/+FNiJF\n" +
      "7v5x1xAd6O+X+5pXR3J1O15VhR2fhmJQG1bBwl5k6uGVWB5b1aPL3d7E6cZF3+bE\n" +
      "-----END CERTIFICATE-----"
    );
  });

  // Override signature promise - return empty for demo mode
  qz.security.setSignaturePromise(function() {
    return function() {
      return Promise.resolve("");
    };
  });
}

// Initialize QZ Tray connection
async function connectQZ(): Promise<boolean> {
  if (qzConnected && qz.websocket.isActive()) {
    return true;
  }

  try {
    initQZ();
    await qz.websocket.connect();
    qzConnected = true;
    console.log('QZ Tray connected successfully');
    return true;
  } catch (err: any) {
    console.error('QZ Tray connection failed:', err?.message || err);
    // Fallback to regular print dialog
    return false;
  }
}

// Find Argox printer
async function findArgoxPrinter(): Promise<string | null> {
  try {
    const printers = await qz.printers.find();
    // Look for Argox printer
    const argox = printers.find((p: string) =>
      p.toLowerCase().includes('argox') ||
      p.toLowerCase().includes('os-214')
    );
    if (argox) {
      console.log('Found Argox printer:', argox);
      return argox;
    }
    // Return first available printer if Argox not found
    if (printers.length > 0) {
      console.log('Using default printer:', printers[0]);
      return printers[0];
    }
    return null;
  } catch (err) {
    console.error('Failed to find printers:', err);
    return null;
  }
}

// Silent print using QZ Tray
async function silentPrint(doc: jsPDF): Promise<boolean> {
  try {
    const connected = await connectQZ();
    if (!connected) {
      return false;
    }

    const printer = await findArgoxPrinter();
    if (!printer) {
      console.error('No printer found');
      return false;
    }

    // Get PDF as base64
    const pdfBase64 = doc.output('datauristring');

    // Configure print job
    const config = qz.configs.create(printer, {
      size: { width: 60, height: 80 },
      units: 'mm',
      scaleContent: true
    });

    // Print the PDF
    const data: Array<{ type: 'pdf'; data: string }> = [{
      type: 'pdf',
      data: pdfBase64
    }];

    await qz.print(config, data);
    console.log('Print job sent successfully');
    return true;
  } catch (err) {
    console.error('Silent print failed:', err);
    return false;
  }
}

// Fallback print using browser dialog
function fallbackPrint(doc: jsPDF): void {
  const pdfBlob = doc.output('blob');
  const pdfUrl = URL.createObjectURL(pdfBlob);
  const printWindow = window.open(pdfUrl, '_blank');
  if (printWindow) {
    printWindow.onload = () => {
      printWindow.print();
    };
  }
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

  // Try silent print with QZ Tray, fallback to browser dialog
  silentPrint(doc).then(success => {
    if (!success) {
      console.log('QZ Tray not available, using fallback print');
      fallbackPrint(doc);
    }
  });

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

  // Black header bar
  doc.setFillColor(0, 0, 0);
  doc.rect(0, 0, LABEL_WIDTH, 10, 'F');

  // Title in white
  doc.setTextColor(white);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('DELIVERY LABEL', LABEL_WIDTH / 2, 6, { align: 'center' });

  // Package info
  doc.setFontSize(6);
  doc.text(`${pkg.sequenceNumber}/${totalPackages}`, LABEL_WIDTH - margin, 6, { align: 'right' });

  // Reset to black text
  doc.setTextColor(black);

  let yPos = 14;

  // Hotel Name - prominent
  doc.setFontSize(5);
  doc.setFont('helvetica', 'normal');
  doc.text('HOTEL', margin, yPos);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  const hotelName = delivery.tenant?.name || 'Unknown Hotel';
  // Truncate if too long
  const maxHotelLen = 18;
  const displayHotel = hotelName.length > maxHotelLen ? hotelName.substring(0, maxHotelLen) + '...' : hotelName;
  doc.text(displayHotel, margin, yPos + 4);

  yPos += 10;

  // Barcode section
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.2);
  doc.rect(margin, yPos, LABEL_WIDTH - (margin * 2), 18, 'S');

  // Draw barcode
  drawBarcode(doc, pkg.packageBarcode, margin + 2, yPos + 2, LABEL_WIDTH - (margin * 2) - 4, 10);

  // Barcode text
  doc.setFontSize(7);
  doc.setFont('courier', 'bold');
  doc.text(pkg.packageBarcode, LABEL_WIDTH / 2, yPos + 15, { align: 'center' });

  yPos += 22;

  // Contents section
  doc.setFontSize(5);
  doc.setFont('helvetica', 'normal');
  doc.text('CONTENTS', margin, yPos);
  yPos += 3;

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
  // Calculate total from itemsByType (user-entered or actual counts)
  const totalItems = itemTypeEntries.reduce((sum, [, item]) => sum + item.count, 0);

  // Display items in compact format
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');

  if (itemTypeEntries.length > 0) {
    itemTypeEntries.forEach(([_typeId, itemType]) => {
      // Truncate name if needed
      const maxNameLen = 20;
      const displayName = itemType.name.length > maxNameLen
        ? itemType.name.substring(0, maxNameLen) + '..'
        : itemType.name;

      doc.text(`${displayName}`, margin, yPos);
      doc.setFont('helvetica', 'bold');
      doc.text(`${itemType.count} adet`, LABEL_WIDTH - margin, yPos, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      yPos += 4;

      // Show discord/lekeli for this type
      if (itemType.discardCount > 0) {
        doc.setFontSize(6);
        doc.setFont('helvetica', 'normal');
        doc.text(`  Discord: ${itemType.discardCount}`, margin, yPos);
        yPos += 3;
      }
      if (itemType.hasarliCount > 0) {
        doc.setFontSize(6);
        doc.setFont('helvetica', 'normal');
        doc.text(`  Lekeli: ${itemType.hasarliCount}`, margin, yPos);
        yPos += 3;
      }
      doc.setFontSize(7);
    });
  } else {
    doc.setFont('helvetica', 'italic');
    doc.text('No items', margin, yPos);
    yPos += 4;
  }

  yPos += 2;

  // Calculate total discard and hasarli counts
  let totalDiscard = 0;
  let totalHasarli = 0;
  if (labelExtraData) {
    labelExtraData.forEach(e => {
      totalDiscard += e.discardCount;
      totalHasarli += e.hasarliCount;
    });
  }

  // Total bar
  doc.setFillColor(0, 0, 0);
  doc.rect(margin, yPos, LABEL_WIDTH - (margin * 2), 6, 'F');

  doc.setTextColor(white);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text(`TOTAL: ${totalItems} ITEMS`, LABEL_WIDTH / 2, yPos + 4, { align: 'center' });

  yPos += 10;

  // Display total discard and hasarli if any
  doc.setTextColor(black);
  if (totalDiscard > 0 || totalHasarli > 0) {
    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    if (totalDiscard > 0) {
      doc.text(`Discord: ${totalDiscard}`, margin, yPos);
      yPos += 3;
    }
    if (totalHasarli > 0) {
      doc.text(`Lekeli Urun: ${totalHasarli}`, margin, yPos);
      yPos += 3;
    }
    yPos += 1;
  }

  // Date
  doc.setTextColor(black);
  doc.setFontSize(5);
  doc.setFont('helvetica', 'normal');
  const date = new Date(delivery.createdAt || Date.now()).toLocaleDateString('tr-TR');
  doc.text(`Tarih: ${date}`, margin, yPos);

  // Footer line
  const footerY = LABEL_HEIGHT - 6;
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

  // Try silent print with QZ Tray, fallback to browser dialog
  silentPrint(doc).then(success => {
    if (!success) {
      console.log('QZ Tray not available, using fallback print');
      fallbackPrint(doc);
    }
  });

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

  // Black header bar
  doc.setFillColor(0, 0, 0);
  doc.rect(0, 0, LABEL_WIDTH, 10, 'F');

  // Title in white
  doc.setTextColor(white);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('DELIVERY LABEL', LABEL_WIDTH / 2, 6, { align: 'center' });

  // Package info
  doc.setFontSize(6);
  doc.text(`${packageNumber}/${totalPackages}`, LABEL_WIDTH - margin, 6, { align: 'right' });

  // Reset to black text
  doc.setTextColor(black);

  let yPos = 14;

  // Hotel Name - prominent
  doc.setFontSize(5);
  doc.setFont('helvetica', 'normal');
  doc.text('HOTEL', margin, yPos);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  const hotelName = data.tenant?.name || 'Unknown Hotel';
  const maxHotelLen = 18;
  const displayHotel = hotelName.length > maxHotelLen ? hotelName.substring(0, maxHotelLen) + '...' : hotelName;
  doc.text(displayHotel, margin, yPos + 4);

  yPos += 10;

  // Barcode section
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

  yPos += 22;

  // Contents section
  doc.setFontSize(5);
  doc.setFont('helvetica', 'normal');
  doc.text('CONTENTS', margin, yPos);
  yPos += 3;

  // Display items
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');

  let totalItems = 0;
  let totalDiscard = 0;
  let totalHasarli = 0;

  if (data.items.length > 0) {
    data.items.forEach((item) => {
      const maxNameLen = 20;
      const displayName = item.typeName.length > maxNameLen
        ? item.typeName.substring(0, maxNameLen) + '..'
        : item.typeName;

      doc.text(`${displayName}`, margin, yPos);
      doc.setFont('helvetica', 'bold');
      doc.text(`${item.count} adet`, LABEL_WIDTH - margin, yPos, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      yPos += 4;

      totalItems += item.count;
      totalDiscard += item.discardCount;
      totalHasarli += item.hasarliCount;

      // Show discord/lekeli for this item
      if (item.discardCount > 0) {
        doc.setFontSize(6);
        doc.text(`  Discord: ${item.discardCount}`, margin, yPos);
        yPos += 3;
      }
      if (item.hasarliCount > 0) {
        doc.setFontSize(6);
        doc.text(`  Lekeli: ${item.hasarliCount}`, margin, yPos);
        yPos += 3;
      }
      doc.setFontSize(7);
    });
  } else {
    doc.setFont('helvetica', 'italic');
    doc.text('No items', margin, yPos);
    yPos += 4;
  }

  yPos += 2;

  // Total bar
  doc.setFillColor(0, 0, 0);
  doc.rect(margin, yPos, LABEL_WIDTH - (margin * 2), 6, 'F');

  doc.setTextColor(white);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text(`TOTAL: ${totalItems} ITEMS`, LABEL_WIDTH / 2, yPos + 4, { align: 'center' });

  yPos += 10;

  // Display total discard and hasarli if any
  doc.setTextColor(black);
  if (totalDiscard > 0 || totalHasarli > 0) {
    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    if (totalDiscard > 0) {
      doc.text(`Discord: ${totalDiscard}`, margin, yPos);
      yPos += 3;
    }
    if (totalHasarli > 0) {
      doc.text(`Lekeli Urun: ${totalHasarli}`, margin, yPos);
      yPos += 3;
    }
    yPos += 1;
  }

  // Date
  doc.setTextColor(black);
  doc.setFontSize(5);
  doc.setFont('helvetica', 'normal');
  const date = new Date().toLocaleDateString('tr-TR');
  doc.text(`Tarih: ${date}`, margin, yPos);

  // Footer line
  const footerY = LABEL_HEIGHT - 6;
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
