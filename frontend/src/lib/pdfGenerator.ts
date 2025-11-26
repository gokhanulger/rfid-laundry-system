import { jsPDF } from 'jspdf';
import type { Delivery, DeliveryPackage } from '../types';

// Label size: 60mm x 80mm
const LABEL_WIDTH = 60;
const LABEL_HEIGHT = 80;

export function generateDeliveryLabel(delivery: Delivery) {
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

  labelsToGenerate.forEach((pkg, index) => {
    if (index > 0) {
      doc.addPage([LABEL_WIDTH, LABEL_HEIGHT]);
    }

    generateSingleLabel(doc, delivery, pkg, labelsToGenerate.length);
  });

  // Generate filename
  const filename = `delivery-${delivery.barcode}-${Date.now()}.pdf`;

  // Save the PDF
  doc.save(filename);

  return filename;
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
  totalPackages: number
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
  const itemsByType: Record<string, { name: string; count: number }> = {};

  if (delivery.deliveryItems && delivery.deliveryItems.length > 0) {
    delivery.deliveryItems.forEach((di: any) => {
      const item = di.item;
      const typeName = item?.itemType?.name || 'Unknown';
      const typeId = item?.itemTypeId || 'unknown';

      if (!itemsByType[typeId]) {
        itemsByType[typeId] = { name: typeName, count: 0 };
      }
      itemsByType[typeId].count++;
    });
  }

  const itemTypeEntries = Object.values(itemsByType);
  const totalItems = delivery.deliveryItems?.length || 0;

  // Display items in compact format
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');

  if (itemTypeEntries.length > 0) {
    itemTypeEntries.forEach((itemType) => {
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
