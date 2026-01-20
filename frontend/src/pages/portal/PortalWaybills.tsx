import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  FileText,
  Search,
  ChevronLeft,
  ChevronRight,
  Filter,
  Package,
  X,
  Loader2,
  CheckCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { portalApi, PortalWaybill } from '../../lib/api';

export function PortalWaybills() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedWaybill, setSelectedWaybill] = useState<PortalWaybill | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['portal', 'waybills', page, search, startDate, endDate],
    queryFn: () => portalApi.getWaybills({
      page,
      limit: 20,
      search: search || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }),
  });

  const statusLabels: Record<string, { label: string; color: string }> = {
    created: { label: 'Olusturuldu', color: 'bg-gray-100 text-gray-700' },
    printed: { label: 'Basildi', color: 'bg-blue-100 text-blue-700' },
    picked_up: { label: 'Teslim Alindi', color: 'bg-orange-100 text-orange-700' },
    delivered: { label: 'Teslim Edildi', color: 'bg-green-100 text-green-700' },
  };

  const clearFilters = () => {
    setSearch('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  return (
    <div className="p-4 md:p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="mb-6">
        <Link to="/portal" className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1 mb-2">
          <ChevronLeft className="w-4 h-4" /> Portal
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileText className="w-7 h-7 text-blue-600" />
          Irsaliyeler
        </h1>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6">
        <div className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Irsaliye numarasi ara..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <Filter className="w-5 h-5" />
              Filtreler
              {(startDate || endDate) && (
                <span className="w-2 h-2 bg-blue-500 rounded-full" />
              )}
            </button>
          </div>

          {/* Extended Filters */}
          {showFilters && (
            <div className="mt-4 pt-4 border-t border-gray-100 grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Baslangic Tarihi</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bitis Tarihi</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={clearFilters}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
                >
                  Temizle
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        {isLoading ? (
          <div className="p-8 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
            <p className="mt-2 text-gray-500">Yukleniyor...</p>
          </div>
        ) : data?.data && data.data.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th className="px-4 py-3 font-medium">Irsaliye No</th>
                    <th className="px-4 py-3 font-medium">Tarih</th>
                    <th className="px-4 py-3 font-medium">Durum</th>
                    <th className="px-4 py-3 font-medium">Paket</th>
                    <th className="px-4 py-3 font-medium">Cuval</th>
                    <th className="px-4 py-3 font-medium">Urun</th>
                    <th className="px-4 py-3 font-medium">ETA</th>
                    <th className="px-4 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.data.map((waybill) => (
                    <tr key={waybill.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono font-medium">{waybill.waybillNumber}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {format(new Date(waybill.createdAt), 'dd MMM yyyy HH:mm', { locale: tr })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusLabels[waybill.status]?.color || 'bg-gray-100'}`}>
                          {statusLabels[waybill.status]?.label || waybill.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">{waybill.packageCount}</td>
                      <td className="px-4 py-3">{waybill.bagCount}</td>
                      <td className="px-4 py-3">{waybill.totalItems}</td>
                      <td className="px-4 py-3">
                        {waybill.etaSynced ? (
                          <span className="flex items-center gap-1 text-green-600">
                            <CheckCircle className="w-4 h-4" />
                            <span className="text-xs">{waybill.etaRefNo}</span>
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setSelectedWaybill(waybill)}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          Detay
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {data.pagination && data.pagination.totalPages > 1 && (
              <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
                <p className="text-sm text-gray-500">
                  Toplam {data.pagination.total} irsaliye
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-2 rounded-lg border border-gray-200 disabled:opacity-50 hover:bg-gray-50"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm text-gray-600">
                    {page} / {data.pagination.totalPages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(data.pagination.totalPages, p + 1))}
                    disabled={page === data.pagination.totalPages}
                    className="p-2 rounded-lg border border-gray-200 disabled:opacity-50 hover:bg-gray-50"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="p-8 text-center">
            <Package className="w-12 h-12 text-gray-300 mx-auto" />
            <p className="mt-2 text-gray-500">Irsaliye bulunamadi</p>
          </div>
        )}
      </div>

      {/* Waybill Detail Modal */}
      {selectedWaybill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Irsaliye Detayi</h3>
              <button
                onClick={() => setSelectedWaybill(null)}
                className="p-1 hover:bg-gray-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Irsaliye No</p>
                    <p className="font-mono font-medium">{selectedWaybill.waybillNumber}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Durum</p>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusLabels[selectedWaybill.status]?.color}`}>
                      {statusLabels[selectedWaybill.status]?.label}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Olusturma Tarihi</p>
                    <p className="font-medium">
                      {format(new Date(selectedWaybill.createdAt), 'dd MMM yyyy HH:mm', { locale: tr })}
                    </p>
                  </div>
                  {selectedWaybill.deliveredAt && (
                    <div>
                      <p className="text-sm text-gray-500">Teslim Tarihi</p>
                      <p className="font-medium">
                        {format(new Date(selectedWaybill.deliveredAt), 'dd MMM yyyy HH:mm', { locale: tr })}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-gray-500">Paket Sayisi</p>
                    <p className="font-medium">{selectedWaybill.packageCount}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Cuval Sayisi</p>
                    <p className="font-medium">{selectedWaybill.bagCount}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Toplam Urun</p>
                    <p className="font-medium">{selectedWaybill.totalItems}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Teslimat Sayisi</p>
                    <p className="font-medium">{selectedWaybill.deliveryCount}</p>
                  </div>
                </div>

                {/* ETA Info */}
                {selectedWaybill.etaSynced && (
                  <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex items-center gap-2 text-green-800">
                      <CheckCircle className="w-5 h-5" />
                      <span className="font-medium">ETA Sistemiyle Senkronize</span>
                    </div>
                    {selectedWaybill.etaRefNo && (
                      <p className="text-sm text-green-600 mt-1">Referans: {selectedWaybill.etaRefNo}</p>
                    )}
                  </div>
                )}

                {/* Item Summary */}
                {selectedWaybill.itemSummary && Object.keys(selectedWaybill.itemSummary).length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-gray-700 mb-2">Urun Ozeti</p>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries(selectedWaybill.itemSummary).map(([type, count]) => (
                          <div key={type} className="flex justify-between text-sm">
                            <span className="text-gray-600">{type}</span>
                            <span className="font-medium">{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
