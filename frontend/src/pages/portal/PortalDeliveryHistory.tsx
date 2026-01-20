import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  Truck,
  Search,
  ChevronLeft,
  ChevronRight,
  Filter,
  Package,
  X,
  Loader2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { portalApi, PortalDelivery } from '../../lib/api';

export function PortalDeliveryHistory() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedDelivery, setSelectedDelivery] = useState<PortalDelivery | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['portal', 'deliveries', page, search, status, startDate, endDate],
    queryFn: () => portalApi.getDeliveries({
      page,
      limit: 20,
      search: search || undefined,
      status: status || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }),
  });

  const statusLabels: Record<string, { label: string; color: string }> = {
    created: { label: 'Olusturuldu', color: 'bg-gray-100 text-gray-700' },
    label_printed: { label: 'Etiket Basildi', color: 'bg-blue-100 text-blue-700' },
    packaged: { label: 'Paketlendi', color: 'bg-purple-100 text-purple-700' },
    picked_up: { label: 'Teslim Alindi', color: 'bg-orange-100 text-orange-700' },
    in_transit: { label: 'Yolda', color: 'bg-yellow-100 text-yellow-700' },
    delivered: { label: 'Teslim Edildi', color: 'bg-green-100 text-green-700' },
  };

  const clearFilters = () => {
    setSearch('');
    setStatus('');
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
          <Truck className="w-7 h-7 text-green-600" />
          Teslimat Gecmisi
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
                placeholder="Barkod ara..."
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
              {(status || startDate || endDate) && (
                <span className="w-2 h-2 bg-blue-500 rounded-full" />
              )}
            </button>
          </div>

          {/* Extended Filters */}
          {showFilters && (
            <div className="mt-4 pt-4 border-t border-gray-100 grid md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Durum</label>
                <select
                  value={status}
                  onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Tumu</option>
                  {Object.entries(statusLabels).map(([key, { label }]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
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
                    <th className="px-4 py-3 font-medium">Barkod</th>
                    <th className="px-4 py-3 font-medium">Tarih</th>
                    <th className="px-4 py-3 font-medium">Durum</th>
                    <th className="px-4 py-3 font-medium">Paket</th>
                    <th className="px-4 py-3 font-medium">Urun</th>
                    <th className="px-4 py-3 font-medium">Surucu</th>
                    <th className="px-4 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.data.map((delivery) => (
                    <tr key={delivery.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono font-medium">{delivery.barcode}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {format(new Date(delivery.createdAt), 'dd MMM yyyy HH:mm', { locale: tr })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusLabels[delivery.status]?.color || 'bg-gray-100'}`}>
                          {statusLabels[delivery.status]?.label || delivery.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">{delivery.packageCount}</td>
                      <td className="px-4 py-3">{delivery.itemCount}</td>
                      <td className="px-4 py-3 text-gray-600">{delivery.driver?.name || '-'}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setSelectedDelivery(delivery)}
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
                  Toplam {data.pagination.total} teslimat
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
            <p className="mt-2 text-gray-500">Teslimat bulunamadi</p>
          </div>
        )}
      </div>

      {/* Delivery Detail Modal */}
      {selectedDelivery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Teslimat Detayi</h3>
              <button
                onClick={() => setSelectedDelivery(null)}
                className="p-1 hover:bg-gray-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Barkod</p>
                    <p className="font-mono font-medium">{selectedDelivery.barcode}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Durum</p>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusLabels[selectedDelivery.status]?.color}`}>
                      {statusLabels[selectedDelivery.status]?.label}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Olusturma Tarihi</p>
                    <p className="font-medium">
                      {format(new Date(selectedDelivery.createdAt), 'dd MMM yyyy HH:mm', { locale: tr })}
                    </p>
                  </div>
                  {selectedDelivery.deliveredAt && (
                    <div>
                      <p className="text-sm text-gray-500">Teslim Tarihi</p>
                      <p className="font-medium">
                        {format(new Date(selectedDelivery.deliveredAt), 'dd MMM yyyy HH:mm', { locale: tr })}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-gray-500">Paket Sayisi</p>
                    <p className="font-medium">{selectedDelivery.packageCount}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Surucu</p>
                    <p className="font-medium">{selectedDelivery.driver?.name || '-'}</p>
                  </div>
                </div>

                {selectedDelivery.items && selectedDelivery.items.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-gray-700 mb-2">Urunler ({selectedDelivery.items.length})</p>
                    <div className="bg-gray-50 rounded-lg p-3 max-h-48 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500">
                            <th className="text-left pb-2">RFID Tag</th>
                            <th className="text-left pb-2">Tur</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {selectedDelivery.items.map((item) => (
                            <tr key={item.id}>
                              <td className="py-1 font-mono">{item.rfidTag}</td>
                              <td className="py-1">{item.itemType || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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
