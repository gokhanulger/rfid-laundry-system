import PDFDocument from 'pdfkit';

interface WaybillPdfData {
  waybillNumber: string;
  hotelName: string;
  date: string;
  itemSummary: Array<{ typeName: string; count: number }>;
  bagCount: number;
  packageCount: number;
  totalItems: number;
}

export function generateWaybillPdf(data: WaybillPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const margin = 50;
    const contentWidth = pageWidth - margin * 2;

    // Header
    doc.fontSize(18).font('Helvetica-Bold');
    doc.text('TEMIZ IRSALIYESI', margin, 40, { align: 'right' });

    // Hotel name
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Sayin:', margin, 70);
    doc.fontSize(13).font('Helvetica-Bold');
    doc.text(data.hotelName, margin, 82);

    // Document info (right side)
    const rightX = pageWidth - margin - 150;
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Belge No:', rightX, 70);
    doc.font('Helvetica').text(data.waybillNumber, rightX + 55, 70);
    doc.font('Helvetica-Bold').text('Tarih:', rightX, 84);
    doc.font('Helvetica').text(data.date, rightX + 55, 84);

    // Separator line
    let y = 110;
    doc.moveTo(margin, y).lineTo(pageWidth - margin, y).lineWidth(1).stroke();
    y += 12;

    // Table header
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('CINSI', margin, y);
    doc.text('MIKTARI', pageWidth - margin - 60, y, { width: 60, align: 'right' });

    y += 5;
    doc.moveTo(margin, y).lineTo(pageWidth - margin, y).lineWidth(0.5).stroke();
    y += 10;

    // Items
    doc.font('Helvetica').fontSize(11);
    for (const item of data.itemSummary) {
      doc.text(item.typeName.toUpperCase(), margin, y);
      doc.text(`${item.count} adet`, pageWidth - margin - 60, y, { width: 60, align: 'right' });
      y += 20;
    }

    y += 15;

    // Totals
    doc.fontSize(13).font('Helvetica-Bold');
    doc.text('CUVAL SAYISI :', margin, y);
    doc.text(data.bagCount.toString(), pageWidth - margin - 60, y, { width: 60, align: 'right' });
    y += 20;
    doc.text('PAKET SAYISI :', margin, y);
    doc.text(data.packageCount.toString(), pageWidth - margin - 60, y, { width: 60, align: 'right' });
    y += 20;
    doc.text('TOPLAM URUN :', margin, y);
    doc.text(data.totalItems.toString(), pageWidth - margin - 60, y, { width: 60, align: 'right' });

    y += 30;

    // Separator
    doc.moveTo(margin, y).lineTo(pageWidth - margin, y).lineWidth(1).stroke();
    y += 20;

    // Signature section
    doc.fontSize(10).font('Helvetica');
    const sigWidth = contentWidth / 2;
    doc.text('Teslim Eden', margin, y, { width: sigWidth, align: 'center' });
    doc.text('Teslim Alan', margin + sigWidth, y, { width: sigWidth, align: 'center' });

    y += 30;
    doc.moveTo(margin + 20, y).lineTo(margin + sigWidth - 20, y).lineWidth(0.5).stroke();
    doc.moveTo(margin + sigWidth + 20, y).lineTo(pageWidth - margin - 20, y).lineWidth(0.5).stroke();

    // Footer
    doc.fontSize(8).font('Helvetica');
    doc.text('RFID Camasirhane Sistemi', margin, doc.page.height - 40, {
      width: contentWidth,
      align: 'center',
    });

    doc.end();
  });
}
