import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { settingsApi } from '../lib/api';
import type { Tenant } from '../types';
import { Printer, Download, QrCode, RefreshCw } from 'lucide-react';

export default function HotelQRCodesPage() {
  const [hotels, setHotels] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadHotels();
  }, []);

  const loadHotels = async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getTenants();
      setHotels(data);
    } catch (err) {
      setError('Oteller yüklenirken hata oluştu');
    } finally {
      setLoading(false);
    }
  };

  const handlePrintAll = () => {
    const printContent = document.getElementById('print-all-qr');
    if (printContent) {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>Otel QR Kodları</title>
              <style>
                body {
                  font-family: Arial, sans-serif;
                  padding: 20px;
                }
                .qr-grid {
                  display: grid;
                  grid-template-columns: repeat(3, 1fr);
                  gap: 30px;
                  page-break-inside: auto;
                }
                .qr-card {
                  border: 2px solid #e5e7eb;
                  border-radius: 12px;
                  padding: 20px;
                  text-align: center;
                  page-break-inside: avoid;
                }
                .qr-card h3 {
                  margin: 0 0 5px 0;
                  font-size: 14px;
                  color: #1f2937;
                }
                .qr-card p {
                  margin: 0 0 15px 0;
                  font-size: 11px;
                  color: #6b7280;
                }
                .qr-code {
                  margin: 0 auto 10px;
                }
                .qr-value {
                  font-family: monospace;
                  font-size: 12px;
                  color: #374151;
                  background: #f3f4f6;
                  padding: 4px 8px;
                  border-radius: 4px;
                }
                @media print {
                  .qr-grid {
                    grid-template-columns: repeat(3, 1fr);
                  }
                  .qr-card {
                    break-inside: avoid;
                  }
                }
              </style>
            </head>
            <body>
              <h1 style="text-align: center; margin-bottom: 30px;">Otel QR Kodları</h1>
              ${printContent.innerHTML}
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.print();
      }
    }
  };

  const handlePrintSingle = (hotel: Tenant) => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>${hotel.name} - QR Kod</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                margin: 0;
              }
              .qr-card {
                border: 3px solid #1f2937;
                border-radius: 16px;
                padding: 40px;
                text-align: center;
                max-width: 400px;
              }
              .qr-card h2 {
                margin: 0 0 10px 0;
                font-size: 24px;
                color: #1f2937;
              }
              .qr-card p {
                margin: 0 0 25px 0;
                font-size: 14px;
                color: #6b7280;
              }
              .qr-code {
                margin: 0 auto 20px;
              }
              .qr-value {
                font-family: monospace;
                font-size: 18px;
                color: #374151;
                background: #f3f4f6;
                padding: 8px 16px;
                border-radius: 8px;
                display: inline-block;
              }
              .instructions {
                margin-top: 20px;
                font-size: 12px;
                color: #9ca3af;
              }
            </style>
          </head>
          <body>
            <div class="qr-card">
              <h2>${hotel.name}</h2>
              <p>${hotel.address || 'Adres belirtilmemiş'}</p>
              <div class="qr-code" id="qr-container"></div>
              <div class="qr-value">${hotel.qrCode || 'QR Kod Yok'}</div>
              <p class="instructions">Bu QR kodu tarayarak oteli hızlıca seçebilirsiniz</p>
            </div>
            <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
            <script>
              QRCode.toCanvas(document.createElement('canvas'), '${hotel.qrCode}', { width: 200 }, function(error, canvas) {
                if (!error) {
                  document.getElementById('qr-container').appendChild(canvas);
                }
              });
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
      setTimeout(() => printWindow.print(), 500);
    }
  };

  const downloadQRCode = (hotel: Tenant) => {
    const svg = document.getElementById(`qr-${hotel.id}`);
    if (svg) {
      const svgData = new XMLSerializer().serializeToString(svg);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      img.onload = () => {
        canvas.width = 300;
        canvas.height = 300;
        ctx?.drawImage(img, 0, 0, 300, 300);

        const pngFile = canvas.toDataURL('image/png');
        const downloadLink = document.createElement('a');
        downloadLink.download = `${hotel.name.replace(/\s+/g, '_')}_QR.png`;
        downloadLink.href = pngFile;
        downloadLink.click();
      };

      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        {error}
      </div>
    );
  }

  const hotelsWithQR = hotels.filter(h => h.qrCode);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <QrCode className="w-7 h-7" />
            Otel QR Kodları
          </h1>
          <p className="text-gray-600 mt-1">
            {hotelsWithQR.length} otel için QR kodları
          </p>
        </div>
        <button
          onClick={handlePrintAll}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Printer className="w-5 h-5" />
          Tümünü Yazdır
        </button>
      </div>

      {/* QR Code Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {hotelsWithQR.map((hotel) => (
          <div
            key={hotel.id}
            className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
          >
            <div className="text-center">
              <h3 className="font-semibold text-gray-900 mb-1 truncate" title={hotel.name}>
                {hotel.name}
              </h3>
              <p className="text-sm text-gray-500 mb-4 truncate" title={hotel.address || ''}>
                {hotel.address || 'Adres belirtilmemiş'}
              </p>

              {/* QR Code */}
              <div className="flex justify-center mb-4">
                <QRCodeSVG
                  id={`qr-${hotel.id}`}
                  value={hotel.qrCode || ''}
                  size={160}
                  level="H"
                  includeMargin={true}
                />
              </div>

              {/* QR Value */}
              <div className="bg-gray-100 rounded-lg px-3 py-2 mb-4">
                <code className="text-sm font-mono text-gray-700">
                  {hotel.qrCode}
                </code>
              </div>

              {/* Actions */}
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => handlePrintSingle(hotel)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  <Printer className="w-4 h-4" />
                  Yazdır
                </button>
                <button
                  onClick={() => downloadQRCode(hotel)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  İndir
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Hidden Print Container */}
      <div id="print-all-qr" className="hidden">
        <div className="qr-grid">
          {hotelsWithQR.map((hotel) => (
            <div key={hotel.id} className="qr-card">
              <h3>{hotel.name}</h3>
              <p>{hotel.address || 'Adres belirtilmemiş'}</p>
              <div className="qr-code">
                <QRCodeSVG
                  value={hotel.qrCode || ''}
                  size={120}
                  level="H"
                  includeMargin={true}
                />
              </div>
              <span className="qr-value">{hotel.qrCode}</span>
            </div>
          ))}
        </div>
      </div>

      {/* No QR Hotels */}
      {hotels.filter(h => !h.qrCode).length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-medium text-yellow-800 mb-2">QR Kodu Olmayan Oteller</h3>
          <div className="flex flex-wrap gap-2">
            {hotels.filter(h => !h.qrCode).map(hotel => (
              <span key={hotel.id} className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-sm">
                {hotel.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
