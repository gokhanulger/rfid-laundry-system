import PDFDocument from 'pdfkit';
import path from 'path';

const FONT_REGULAR = path.join(__dirname, '..', 'fonts', 'Roboto-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'fonts', 'Roboto-Bold.ttf');

interface WaybillPdfData {
  waybillNumber: string;
  hotelName: string;
  hotelAddress?: string;
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

    // Register Turkish-supporting fonts
    doc.registerFont('Roboto', FONT_REGULAR);
    doc.registerFont('Roboto-Bold', FONT_BOLD);

    const pageWidth = doc.page.width;
    const margin = 50;
    const contentWidth = pageWidth - margin * 2;

    // Header - right aligned
    doc.fontSize(20).font('Roboto-Bold');
    doc.text('TEMİZ İRSALİYESİ', margin, 40, { align: 'right' });

    // Hotel name - left side
    doc.fontSize(10).font('Roboto-Bold');
    doc.text('Sayın:', margin, 80);
    doc.fontSize(14).font('Roboto-Bold');
    doc.text(data.hotelName, margin, 95);

    if (data.hotelAddress) {
      doc.fontSize(9).font('Roboto');
      doc.text(data.hotelAddress, margin, 112);
    }

    // Document info - right side
    const rightX = pageWidth - margin - 160;
    const infoY = 80;
    doc.fontSize(10).font('Roboto-Bold');
    doc.text('Belge No:', rightX, infoY);
    doc.font('Roboto').text(data.waybillNumber, rightX + 60, infoY);
    doc.font('Roboto-Bold').text('Tarih:', rightX, infoY + 16);
    doc.font('Roboto').text(data.date, rightX + 60, infoY + 16);

    // Separator line
    let y = 140;
    doc.moveTo(margin, y).lineTo(pageWidth - margin, y).lineWidth(1.5).stroke('#0d9488');
    y += 15;

    // Table header
    doc.fontSize(11).font('Roboto-Bold');
    doc.fillColor('#0d9488');
    doc.text('CİNSİ', margin, y);
    doc.text('MİKTARI', pageWidth - margin - 70, y, { width: 70, align: 'right' });
    doc.fillColor('#333333');

    y += 8;
    doc.moveTo(margin, y).lineTo(pageWidth - margin, y).lineWidth(0.5).stroke('#cccccc');
    y += 12;

    // Items
    doc.font('Roboto').fontSize(12);
    for (const item of data.itemSummary) {
      doc.text(item.typeName.toUpperCase(), margin, y);
      doc.text(`${item.count} adet`, pageWidth - margin - 70, y, { width: 70, align: 'right' });
      y += 22;
    }

    y += 10;
    doc.moveTo(margin, y).lineTo(pageWidth - margin, y).lineWidth(0.5).stroke('#cccccc');
    y += 15;

    // Totals
    doc.fontSize(13).font('Roboto-Bold');

    if (data.bagCount > 0) {
      doc.text('ÇUVAL SAYISI :', margin, y);
      doc.text(data.bagCount.toString(), pageWidth - margin - 70, y, { width: 70, align: 'right' });
      y += 22;
    }

    doc.text('PAKET SAYISI :', margin, y);
    doc.text(data.packageCount.toString(), pageWidth - margin - 70, y, { width: 70, align: 'right' });
    y += 22;

    doc.fillColor('#0d9488');
    doc.text('TOPLAM ÜRÜN :', margin, y);
    doc.text(data.totalItems.toString(), pageWidth - margin - 70, y, { width: 70, align: 'right' });
    doc.fillColor('#333333');

    y += 35;

    // Separator
    doc.moveTo(margin, y).lineTo(pageWidth - margin, y).lineWidth(1.5).stroke('#0d9488');
    y += 25;

    // Signature section
    doc.fontSize(10).font('Roboto');
    const sigWidth = contentWidth / 2;
    doc.text('Teslim Eden', margin, y, { width: sigWidth, align: 'center' });
    doc.text('Teslim Alan', margin + sigWidth, y, { width: sigWidth, align: 'center' });

    y += 35;
    doc.moveTo(margin + 20, y).lineTo(margin + sigWidth - 20, y).lineWidth(0.5).stroke();
    doc.moveTo(margin + sigWidth + 20, y).lineTo(pageWidth - margin - 20, y).lineWidth(0.5).stroke();

    // Footer
    doc.fontSize(8).font('Roboto');
    doc.fillColor('#6b7280');
    doc.text('Demet Laundry - RFID Çamaşırhane Takip Sistemi', margin, doc.page.height - 40, {
      width: contentWidth,
      align: 'center',
    });

    doc.end();
  });
}
