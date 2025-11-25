import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Calendar,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Package,
  Truck,
  Building2,
  FileText,
  Filter,
} from 'lucide-react';
import api, { settingsApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Tenant } from '../types';

interface ReconciliationData {
  startDate: string;
  endDate: string;
  totals: {
    totalPickups: number;
    totalDeliveries: number;
    totalPickupItems: number;
    totalDeliveryItems: number;
    pickupsByType: Record<string, number>;
    deliveriesByType: Record<string, number>;
  };
  byDate: Array<{
    date: string;
    pickups: any[];
    deliveries: any[];
    pickupItemCount: number;
    deliveryItemCount: number;
    pickupsByType: Record<string, number>;
    deliveriesByType: Record<string, number>;
  }>;
}

export function ReconciliationPage() {
  const { user } = useAuth();
  const isHotelOwner = user?.role === 'hotel_owner';

  // Date range - default to last 7 days
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [startDate, setStartDate] = useState(weekAgo.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(today.toISOString().split('T')[0]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});
  const [expandedPickups, setExpandedPickups] = useState<Record<string, boolean>>({});
  const [expandedDeliveries, setExpandedDeliveries] = useState<Record<string, boolean>>({});

  // Fetch tenants for filter (not for hotel owners)
  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: settingsApi.getTenants,
    enabled: !isHotelOwner,
  });

  // Fetch reconciliation data
  const { data: reconciliationData, isLoading, refetch } = useQuery({
    queryKey: ['reconciliation', startDate, endDate, selectedTenantId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('startDate', startDate);
      params.append('endDate', endDate);
      if (selectedTenantId) {
        params.append('tenantId', selectedTenantId);
      }
      const { data } = await api.get<ReconciliationData>(`/reconciliation?${params}`);
      return data;
    },
  });

  const toggleDate = (date: string) => {
    setExpandedDates(prev => ({ ...prev, [date]: !prev[date] }));
  };

  const togglePickup = (pickupId: string) => {
    setExpandedPickups(prev => ({ ...prev, [pickupId]: !prev[pickupId] }));
  };

  const toggleDelivery = (deliveryId: string) => {
    setExpandedDeliveries(prev => ({ ...prev, [deliveryId]: !prev[deliveryId] }));
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('tr-TR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Quick date presets
  const setPreset = (days: number) => {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-100 rounded-lg">
            <FileText className="w-8 h-8 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Mutabakat</h1>
            <p className="text-gray-500">Toplama ve teslimat kayitlarini karsilastirin</p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
        >
          <RefreshCw className="w-4 h-4" />
          Yenile
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-5 h-5 text-gray-500" />
          <h2 className="font-semibold text-gray-900">Filtreler</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Date Range */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Baslangic Tarihi
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bitis Tarihi
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {/* Hotel Filter (not for hotel owners) */}
          {!isHotelOwner && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Otel
              </label>
              <select
                value={selectedTenantId}
                onChange={(e) => setSelectedTenantId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="">Tum Oteller</option>
                {tenants?.map((tenant: Tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Quick Presets */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Hizli Secim
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setPreset(7)}
                className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                7 Gun
              </button>
              <button
                onClick={() => setPreset(30)}
                className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                30 Gun
              </button>
              <button
                onClick={() => setPreset(90)}
                className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                90 Gun
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      {reconciliationData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <ArrowDownCircle className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-orange-600">
                  {reconciliationData.totals.totalPickups}
                </p>
                <p className="text-sm text-gray-500">Toplam Toplama</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <ArrowUpCircle className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-green-600">
                  {reconciliationData.totals.totalDeliveries}
                </p>
                <p className="text-sm text-gray-500">Toplam Teslimat</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <Package className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-orange-600">
                  {reconciliationData.totals.totalPickupItems}
                </p>
                <p className="text-sm text-gray-500">Toplanan Urun</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <Package className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-green-600">
                  {reconciliationData.totals.totalDeliveryItems}
                </p>
                <p className="text-sm text-gray-500">Teslim Edilen Urun</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Item Type Breakdown */}
      {reconciliationData && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Pickups by Type */}
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <ArrowDownCircle className="w-5 h-5 text-orange-500" />
              Toplanan Urunler (Ture Gore)
            </h3>
            {Object.keys(reconciliationData.totals.pickupsByType).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(reconciliationData.totals.pickupsByType)
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between py-2 border-b border-gray-100">
                      <span className="text-gray-700">{type}</span>
                      <span className="font-semibold text-orange-600">{count}</span>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-gray-400 text-center py-4">Veri yok</p>
            )}
          </div>

          {/* Deliveries by Type */}
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <ArrowUpCircle className="w-5 h-5 text-green-500" />
              Teslim Edilen Urunler (Ture Gore)
            </h3>
            {Object.keys(reconciliationData.totals.deliveriesByType).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(reconciliationData.totals.deliveriesByType)
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between py-2 border-b border-gray-100">
                      <span className="text-gray-700">{type}</span>
                      <span className="font-semibold text-green-600">{count}</span>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-gray-400 text-center py-4">Veri yok</p>
            )}
          </div>
        </div>
      )}

      {/* Daily Breakdown */}
      <div className="bg-white rounded-xl shadow">
        <div className="p-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-indigo-500" />
            Gunluk Detay
          </h2>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="w-10 h-10 animate-spin text-indigo-500" />
          </div>
        ) : reconciliationData?.byDate.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <Calendar className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <p className="text-lg">Secilen tarih araliginda kayit bulunamadi</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {reconciliationData?.byDate.map((day) => (
              <div key={day.date} className="hover:bg-gray-50">
                {/* Date Header */}
                <button
                  onClick={() => toggleDate(day.date)}
                  className="w-full px-6 py-4 flex items-center justify-between"
                >
                  <div className="flex items-center gap-4">
                    {expandedDates[day.date] ? (
                      <ChevronDown className="w-5 h-5 text-gray-400" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-gray-400" />
                    )}
                    <div className="text-left">
                      <p className="font-medium text-gray-900">{formatDate(day.date)}</p>
                      <p className="text-sm text-gray-500">
                        {day.pickups.length} toplama, {day.deliveries.length} teslimat
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="text-lg font-bold text-orange-600">{day.pickupItemCount}</p>
                      <p className="text-xs text-gray-500">Toplanan</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-green-600">{day.deliveryItemCount}</p>
                      <p className="text-xs text-gray-500">Teslim</p>
                    </div>
                  </div>
                </button>

                {/* Expanded Day Details */}
                {expandedDates[day.date] && (
                  <div className="px-6 pb-4 space-y-4">
                    {/* Pickups Section */}
                    {day.pickups.length > 0 && (
                      <div className="bg-orange-50 rounded-lg p-4">
                        <h4 className="font-medium text-orange-800 mb-3 flex items-center gap-2">
                          <ArrowDownCircle className="w-4 h-4" />
                          Toplamalar ({day.pickups.length})
                        </h4>
                        <div className="space-y-2">
                          {day.pickups.map((pickup: any) => (
                            <div key={pickup.id} className="bg-white rounded-lg border border-orange-200">
                              <button
                                onClick={() => togglePickup(pickup.id)}
                                className="w-full px-4 py-3 flex items-center justify-between"
                              >
                                <div className="flex items-center gap-3">
                                  {expandedPickups[pickup.id] ? (
                                    <ChevronDown className="w-4 h-4 text-gray-400" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4 text-gray-400" />
                                  )}
                                  <Building2 className="w-4 h-4 text-orange-500" />
                                  <span className="font-medium">{pickup.tenant?.name}</span>
                                  <span className="text-sm text-gray-500">
                                    {formatTime(pickup.pickupDate)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-4">
                                  <span className="text-sm text-gray-500">
                                    Torba: {pickup.bagCode}
                                  </span>
                                  <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded-full text-sm font-medium">
                                    {pickup.pickupItems?.length || 0} urun
                                  </span>
                                </div>
                              </button>

                              {/* Pickup Items */}
                              {expandedPickups[pickup.id] && pickup.pickupItems?.length > 0 && (
                                <div className="px-4 pb-3 border-t border-orange-100">
                                  <table className="w-full text-sm mt-2">
                                    <thead>
                                      <tr className="text-left text-gray-500">
                                        <th className="py-2">RFID</th>
                                        <th className="py-2">Tur</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {pickup.pickupItems.map((pi: any) => (
                                        <tr key={pi.id} className="border-t border-gray-100">
                                          <td className="py-2 font-mono text-xs">{pi.item?.rfidTag}</td>
                                          <td className="py-2">{pi.item?.itemType?.name || 'Bilinmeyen'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Deliveries Section */}
                    {day.deliveries.length > 0 && (
                      <div className="bg-green-50 rounded-lg p-4">
                        <h4 className="font-medium text-green-800 mb-3 flex items-center gap-2">
                          <ArrowUpCircle className="w-4 h-4" />
                          Teslimatlar ({day.deliveries.length})
                        </h4>
                        <div className="space-y-2">
                          {day.deliveries.map((delivery: any) => (
                            <div key={delivery.id} className="bg-white rounded-lg border border-green-200">
                              <button
                                onClick={() => toggleDelivery(delivery.id)}
                                className="w-full px-4 py-3 flex items-center justify-between"
                              >
                                <div className="flex items-center gap-3">
                                  {expandedDeliveries[delivery.id] ? (
                                    <ChevronDown className="w-4 h-4 text-gray-400" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4 text-gray-400" />
                                  )}
                                  <Building2 className="w-4 h-4 text-green-500" />
                                  <span className="font-medium">{delivery.tenant?.name}</span>
                                  <span className="text-sm text-gray-500">
                                    {formatTime(delivery.createdAt)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-4">
                                  <span className="text-sm font-mono text-gray-500">
                                    {delivery.barcode}
                                  </span>
                                  <span className={`px-2 py-1 rounded-full text-sm font-medium ${
                                    delivery.status === 'delivered'
                                      ? 'bg-green-100 text-green-700'
                                      : delivery.status === 'picked_up'
                                      ? 'bg-blue-100 text-blue-700'
                                      : 'bg-gray-100 text-gray-700'
                                  }`}>
                                    {delivery.status === 'delivered' ? 'Teslim Edildi' :
                                     delivery.status === 'picked_up' ? 'Yolda' :
                                     delivery.status === 'packaged' ? 'Paketlendi' :
                                     delivery.status === 'label_printed' ? 'Etiketlendi' :
                                     'Olusturuldu'}
                                  </span>
                                  <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                                    {delivery.deliveryItems?.length || 0} urun
                                  </span>
                                </div>
                              </button>

                              {/* Delivery Items */}
                              {expandedDeliveries[delivery.id] && delivery.deliveryItems?.length > 0 && (
                                <div className="px-4 pb-3 border-t border-green-100">
                                  <table className="w-full text-sm mt-2">
                                    <thead>
                                      <tr className="text-left text-gray-500">
                                        <th className="py-2">RFID</th>
                                        <th className="py-2">Tur</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {delivery.deliveryItems.map((di: any) => (
                                        <tr key={di.id} className="border-t border-gray-100">
                                          <td className="py-2 font-mono text-xs">{di.item?.rfidTag}</td>
                                          <td className="py-2">{di.item?.itemType?.name || 'Bilinmeyen'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Day Summary by Type */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-gray-50 rounded-lg p-4">
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Toplanan (Ture Gore)</h5>
                        {Object.entries(day.pickupsByType).map(([type, count]) => (
                          <div key={type} className="flex justify-between text-sm py-1">
                            <span className="text-gray-600">{type}</span>
                            <span className="font-medium text-orange-600">{count}</span>
                          </div>
                        ))}
                        {Object.keys(day.pickupsByType).length === 0 && (
                          <p className="text-sm text-gray-400">Yok</p>
                        )}
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4">
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Teslim Edilen (Ture Gore)</h5>
                        {Object.entries(day.deliveriesByType).map(([type, count]) => (
                          <div key={type} className="flex justify-between text-sm py-1">
                            <span className="text-gray-600">{type}</span>
                            <span className="font-medium text-green-600">{count}</span>
                          </div>
                        ))}
                        {Object.keys(day.deliveriesByType).length === 0 && (
                          <p className="text-sm text-gray-400">Yok</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
