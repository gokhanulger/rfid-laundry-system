import { jsPDF } from 'jspdf';
import type { Delivery, DeliveryPackage } from '../types';

// Label size: 60mm x 80mm
const LABEL_WIDTH = 60;
const LABEL_HEIGHT = 80;

// Type for extra label data (discard/hasarli counts)
export interface LabelExtraItem {
  typeId: string;
  discardCount: number;
  hasarliCount: number;
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

  // Save the PDF
  doc.save(filename);

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

// Generate a simple barcode pattern (Code 128 style visual representation)
function drawBarcode(doc: jsPDF, code: string, x: number, y: number, width: number, height: number) {
  const barWidth = width / (code.length * 11 + 35);
  let currentX = x;

  // Black bars only
  doc.setFillColor(0, 0, 0);

  for (let i = 0; i < code.length; i++) {
    const charCode = code.charCodeAt(i);
    const pattern = getBarPattern(charCode);

    for (let j = 0; j < pattern.length; j++) {
      if (pattern[j] === '1') {
        doc.rect(currentX, y, barWidth, height, 'F');
      }
      currentX += barWidth;
    }
    currentX += barWidth;
  }
}

// Simple pattern generator based on character
function getBarPattern(charCode: number): string {
  const base = charCode % 16;
  const patterns = [
    '11011001', '10011011', '10110011', '11001101',
    '10011101', '11010011', '11001011', '10110101',
    '10101101', '11010101', '10011001', '11011011',
    '10101011', '11010110', '10110110', '11011010'
  ];
  return patterns[base];
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

  // Group items by type
  const itemsByType: Record<string, { name: string; count: number; typeId: string }> = {};

  if (delivery.deliveryItems && delivery.deliveryItems.length > 0) {
    delivery.deliveryItems.forEach((di: any) => {
      const item = di.item;
      const typeName = item?.itemType?.name || 'Unknown';
      const typeId = item?.itemTypeId || 'unknown';

      if (!itemsByType[typeId]) {
        itemsByType[typeId] = { name: typeName, count: 0, typeId };
      }
      itemsByType[typeId].count++;
    });
  }

  const itemTypeEntries = Object.entries(itemsByType);
  const totalItems = delivery.deliveryItems?.length || 0;

  // Display items in compact format
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');

  if (itemTypeEntries.length > 0) {
    itemTypeEntries.forEach(([typeId, itemType]) => {
      // Truncate name if needed
      const maxNameLen = 20;
      const displayName = itemType.name.length > maxNameLen
        ? itemType.name.substring(0, maxNameLen) + '..'
        : itemType.name;

      doc.text(`${displayName}`, margin, yPos);
      doc.setFont('helvetica', 'bold');
      doc.text(`x${itemType.count}`, LABEL_WIDTH - margin, yPos, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      yPos += 4;

      // Check if there's extra data (discard/hasarli) for this type
      if (labelExtraData) {
        const extraData = labelExtraData.find(e => e.typeId === typeId);
        if (extraData) {
          if (extraData.discardCount > 0) {
            doc.setFontSize(6);
            doc.setFont('helvetica', 'normal');
            doc.text(`  Discord: ${extraData.discardCount}`, margin, yPos);
            yPos += 3;
          }
          if (extraData.hasarliCount > 0) {
            doc.setFontSize(6);
            doc.setFont('helvetica', 'normal');
            doc.text(`  Lekeli: ${extraData.hasarliCount}`, margin, yPos);
            yPos += 3;
          }
        }
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
