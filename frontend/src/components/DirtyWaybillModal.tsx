import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { X, Download } from 'lucide-react';
import { DirtyDeclaration } from '../lib/api';
import { Barcode, dirtyBarcodeValue } from './Barcode';

interface Props {
  declaration: DirtyDeclaration;
  hotelName: string;
  onClose: () => void;
}

// Kirli irsaliye PDF/yazdir gorunumu - otel portali ve admin ekraninda ortak kullanilir.
export function DirtyWaybillModal({ declaration: d, hotelName, onClose }: Props) {
  const totalCount = d.items.reduce((s, it) => s + it.count, 0);
  const no = d.declarationNo ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
          <h3 className="font-semibold text-gray-900">Kirli Irsaliye Detayi</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1 px-3 py-1.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-sm"
            >
              <Download className="w-4 h-4" />
              Yazdir / PDF
            </button>
            <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[75vh] print:max-h-none print:overflow-visible">
          {/* Header */}
          <div className="text-center border-b-2 border-gray-800 pb-4 mb-4">
            <h1 className="text-2xl font-bold text-gray-900">KIRLI IRSALIYE</h1>
            <p className="text-3xl font-bold text-orange-600 mt-1">No: {no}</p>
            <div className="flex justify-center mt-2">
              <Barcode value={dirtyBarcodeValue(no)} height={44} />
            </div>
          </div>

          {/* Otel & Tarih */}
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div>
              <p className="text-xs text-gray-500 uppercase">Otel</p>
              <p className="font-semibold text-lg">{hotelName}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 uppercase">Tarih</p>
              <p className="font-semibold">{format(new Date(d.createdAt), 'dd MMMM yyyy', { locale: tr })}</p>
              <p className="text-sm text-gray-600">{format(new Date(d.createdAt), 'HH:mm', { locale: tr })}</p>
            </div>
          </div>

          {/* Ozet */}
          <div className="bg-gray-100 rounded-lg p-4 mb-6">
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-orange-600">{d.items.length}</p>
                <p className="text-xs text-gray-500">Urun Tipi</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-purple-600">{totalCount}</p>
                <p className="text-xs text-gray-500">Toplam Adet</p>
              </div>
            </div>
          </div>

          {/* Urun detaylari */}
          {d.items.length > 0 && (
            <div className="mb-6">
              <h3 className="font-semibold text-gray-900 mb-3 border-b pb-2">Urun Detaylari</h3>
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="text-left px-3 py-2 font-medium text-gray-700">Malin Cinsi</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-700">Adet</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((item, idx) => (
                    <tr key={idx} className="border-b border-gray-100">
                      <td className="px-3 py-2">{item.itemTypeName || '-'}</td>
                      <td className="px-3 py-2 text-right font-semibold">{item.count || 0}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 font-bold">
                    <td className="px-3 py-2">TOPLAM</td>
                    <td className="px-3 py-2 text-right">{totalCount}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Not */}
          {d.notes && (
            <div className="mb-6">
              <p className="text-xs text-gray-500 uppercase mb-1">Not</p>
              <p className="text-sm text-gray-700 italic">{d.notes}</p>
            </div>
          )}

          {/* Durum */}
          <div className="grid grid-cols-2 gap-6 mt-8 pt-4 border-t">
            <div>
              <p className="text-xs text-gray-500 uppercase mb-1">Durum</p>
              {d.status === 'processed' ? (
                <span className="px-3 py-1 text-sm font-medium rounded-full bg-green-100 text-green-700">Yikandi</span>
              ) : (
                <span className="px-3 py-1 text-sm font-medium rounded-full bg-amber-100 text-amber-700">Beklemede</span>
              )}
            </div>
            {d.processedAt && (
              <div className="text-right">
                <p className="text-xs text-gray-500 uppercase mb-1">Yikanma Tarihi</p>
                <p className="font-medium">{format(new Date(d.processedAt), 'dd MMM yyyy HH:mm', { locale: tr })}</p>
              </div>
            )}
          </div>

          {/* Imza alanlari (yazdirmada) */}
          <div className="grid grid-cols-2 gap-6 mt-8 pt-8 border-t print:block hidden">
            <div>
              <p className="text-sm text-gray-500 mb-12">Teslim Eden:</p>
              <div className="border-t border-gray-400 pt-1"><p className="text-xs text-gray-500">Imza / Tarih</p></div>
            </div>
            <div>
              <p className="text-sm text-gray-500 mb-12">Teslim Alan:</p>
              <div className="border-t border-gray-400 pt-1"><p className="text-xs text-gray-500">Imza / Tarih</p></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
