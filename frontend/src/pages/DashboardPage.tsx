import { useQuery } from '@tanstack/react-query';
import {
  Package, Truck, AlertTriangle, CheckCircle,
  TrendingUp, RefreshCw, Clock, Droplets, Tag, AlertCircle
} from 'lucide-react';
import { dashboardApi, HotelStats } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { ItemStatus } from '../types';

const statusLabels: Record<ItemStatus, string> = {
  at_hotel: 'Otelde',
  at_laundry: 'Camasirhanede',
  processing: 'Isleniyor',
  ready_for_delivery: 'Hazir',
  label_printed: 'Etiketlendi',
  packaged: 'Paketlendi',
  in_transit: 'Yolda',
  delivered: 'Teslim Edildi',
};

const statusColors: Record<ItemStatus, string> = {
  at_hotel: 'bg-blue-500',
  at_laundry: 'bg-yellow-500',
  processing: 'bg-orange-500',
  ready_for_delivery: 'bg-green-500',
  label_printed: 'bg-purple-500',
  packaged: 'bg-indigo-500',
  in_transit: 'bg-cyan-500',
  delivered: 'bg-emerald-500',
};

export function DashboardPage() {
  const { user } = useAuth();
  const isHotelOwner = user?.role === 'hotel_owner';

  // Use hotel-specific stats for hotel owners
  const { data: hotelStats, isLoading: hotelLoading, refetch: refetchHotel } = useQuery({
    queryKey: ['hotel-stats'],
    queryFn: dashboardApi.getHotelStats,
    enabled: isHotelOwner,
    refetchInterval: 30000,
  });

  // Use general stats for other roles
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: dashboardApi.getStats,
    enabled: !isHotelOwner,
    refetchInterval: 30000,
  });

  const isLoading = isHotelOwner ? hotelLoading : statsLoading;
  const refetch = isHotelOwner ? refetchHotel : refetchStats;

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  // Render Hotel Owner Dashboard
  if (isHotelOwner && hotelStats) {
    return <HotelOwnerDashboard stats={hotelStats} refetch={refetch} />;
  }

  // Render Standard Dashboard for other roles
  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Kontrol Paneli</h1>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Yenile
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Toplam Urun</p>
              <p className="text-3xl font-bold mt-1">{stats?.totalItems?.toLocaleString() || 0}</p>
            </div>
            <div className="p-3 bg-blue-100 rounded-full">
              <Package className="w-6 h-6 text-blue-500" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Bugunun Toplamalari</p>
              <p className="text-3xl font-bold mt-1">{stats?.todayActivity?.pickups || 0}</p>
            </div>
            <div className="p-3 bg-green-100 rounded-full">
              <Truck className="w-6 h-6 text-green-500" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Bugunun Teslimleri</p>
              <p className="text-3xl font-bold mt-1">{stats?.todayActivity?.deliveries || 0}</p>
            </div>
            <div className="p-3 bg-emerald-100 rounded-full">
              <CheckCircle className="w-6 h-6 text-emerald-500" />
            </div>
          </div>
        </div>
        <div className={`bg-white rounded-lg shadow p-6 ${stats?.unreadAlerts ? 'ring-2 ring-orange-500' : ''}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Okunmamis Uyarilar</p>
              <p className="text-3xl font-bold mt-1">{stats?.unreadAlerts || 0}</p>
            </div>
            <div className="p-3 bg-orange-100 rounded-full">
              <AlertTriangle className="w-6 h-6 text-orange-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Workflow Progress */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-gray-500" />
          Is Akisi Ozeti
        </h2>
        <div className="grid grid-cols-4 md:grid-cols-8 gap-4">
          {stats?.workflowSummary && Object.entries(stats.workflowSummary).map(([key, value]) => {
            const statusKey = key.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '') as ItemStatus;
            const label = statusLabels[statusKey] || key;
            const color = statusColors[statusKey] || 'bg-gray-500';
            return (
              <div key={key} className="text-center">
                <div className={`w-12 h-12 mx-auto rounded-full ${color} flex items-center justify-center text-white font-bold`}>
                  {value}
                </div>
                <p className="text-xs text-gray-600 mt-2 leading-tight">{label}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Pickups */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Truck className="w-5 h-5 text-gray-500" />
            Son Toplamalar
          </h2>
          {stats?.recentPickups && stats.recentPickups.length > 0 ? (
            <div className="space-y-3">
              {stats.recentPickups.map((pickup) => (
                <div key={pickup.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium">{pickup.tenant?.name || 'Unknown'}</p>
                    <p className="text-sm text-gray-500">Bag: {pickup.bagCode}</p>
                  </div>
                  <div className="text-right">
                    <span className={`inline-block px-2 py-1 text-xs rounded-full ${
                      pickup.status === 'created' ? 'bg-yellow-100 text-yellow-800' :
                      pickup.status === 'received' ? 'bg-blue-100 text-blue-800' :
                      'bg-green-100 text-green-800'
                    }`}>
                      {pickup.status}
                    </span>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(pickup.createdAt).toLocaleDateString('tr-TR')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">Son toplama yok</p>
          )}
        </div>

        {/* Recent Deliveries */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-gray-500" />
            Son Teslimler
          </h2>
          {stats?.recentDeliveries && stats.recentDeliveries.length > 0 ? (
            <div className="space-y-3">
              {stats.recentDeliveries.map((delivery) => (
                <div key={delivery.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium">{delivery.tenant?.name || 'Unknown'}</p>
                    <p className="text-sm text-gray-500 font-mono">{delivery.barcode}</p>
                  </div>
                  <div className="text-right">
                    <span className={`inline-block px-2 py-1 text-xs rounded-full ${
                      delivery.status === 'delivered' ? 'bg-green-100 text-green-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>
                      {delivery.status.replace(/_/g, ' ')}
                    </span>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(delivery.createdAt).toLocaleDateString('tr-TR')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">Son teslim yok</p>
          )}
        </div>
      </div>

      {/* Items Needing Attention */}
      {stats?.attentionItems && stats.attentionItems.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            Dikkat Gerektiren Urunler
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-4 text-sm font-medium text-gray-500">RFID Etiketi</th>
                  <th className="text-left py-2 px-4 text-sm font-medium text-gray-500">Tur</th>
                  <th className="text-left py-2 px-4 text-sm font-medium text-gray-500">Sorun</th>
                  <th className="text-left py-2 px-4 text-sm font-medium text-gray-500">Yikama Sayisi</th>
                </tr>
              </thead>
              <tbody>
                {stats.attentionItems.map((item) => (
                  <tr key={item.id} className="border-b hover:bg-gray-50">
                    <td className="py-2 px-4 font-mono text-sm">{item.rfidTag}</td>
                    <td className="py-2 px-4">{item.itemType?.name || 'Unknown'}</td>
                    <td className="py-2 px-4">
                      <div className="flex gap-1">
                        {item.isDamaged && <span className="px-2 py-0.5 text-xs bg-red-100 text-red-800 rounded">Hasarli</span>}
                        {item.isStained && <span className="px-2 py-0.5 text-xs bg-orange-100 text-orange-800 rounded">Lekeli</span>}
                        {item.washCount > 50 && <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded">Yuksek Yikama</span>}
                      </div>
                    </td>
                    <td className="py-2 px-4">{item.washCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// Hotel Owner specific dashboard component
function HotelOwnerDashboard({ stats, refetch }: { stats: HotelStats; refetch: () => void }) {
  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Otel Kontrol Paneli</h1>
          <p className="text-gray-500">Camasir urunleri ve aktivite ozeti</p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Yenile
        </button>
      </div>

      {/* Main Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-blue-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Toplam Urun</p>
              <p className="text-3xl font-bold mt-1 text-blue-600">{stats.totalItems}</p>
            </div>
            <Package className="w-10 h-10 text-blue-200" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-green-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Otelde</p>
              <p className="text-3xl font-bold mt-1 text-green-600">{stats.itemsByStatus['at_hotel'] || 0}</p>
            </div>
            <CheckCircle className="w-10 h-10 text-green-200" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-yellow-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Camasirhanede</p>
              <p className="text-3xl font-bold mt-1 text-yellow-600">{stats.pickupDeliveryStats.itemsAtLaundry}</p>
            </div>
            <Droplets className="w-10 h-10 text-yellow-200" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-purple-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Yolda</p>
              <p className="text-3xl font-bold mt-1 text-purple-600">{stats.pickupDeliveryStats.itemsInTransit}</p>
            </div>
            <Truck className="w-10 h-10 text-purple-200" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-teal-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Ort. Yikama Sayisi</p>
              <p className="text-3xl font-bold mt-1 text-teal-600">{stats.avgWashCount}</p>
            </div>
            <TrendingUp className="w-10 h-10 text-teal-200" />
          </div>
        </div>
      </div>

      {/* Pickup & Delivery Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Truck className="w-5 h-5 text-blue-500" />
            Toplama ve Teslimat Ozeti
          </h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <p className="text-3xl font-bold text-blue-600">{stats.pickupDeliveryStats.totalPickups}</p>
              <p className="text-sm text-gray-600 mt-1">Toplam Toplama</p>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <p className="text-3xl font-bold text-green-600">{stats.pickupDeliveryStats.totalDeliveries}</p>
              <p className="text-sm text-gray-600 mt-1">Toplam Teslimat</p>
            </div>
            <div className="text-center p-4 bg-emerald-50 rounded-lg">
              <p className="text-3xl font-bold text-emerald-600">{stats.pickupDeliveryStats.completedDeliveries}</p>
              <p className="text-sm text-gray-600 mt-1">Tamamlanan</p>
            </div>
          </div>
        </div>

        {/* Discrepancies / Issues */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-500" />
            Tutarsizliklar ve Sorunlar
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className={`p-4 rounded-lg ${stats.discrepancies.damaged > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
              <p className={`text-3xl font-bold ${stats.discrepancies.damaged > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                {stats.discrepancies.damaged}
              </p>
              <p className="text-sm text-gray-600 mt-1">Hasarli Urunler</p>
            </div>
            <div className={`p-4 rounded-lg ${stats.discrepancies.stained > 0 ? 'bg-orange-50' : 'bg-gray-50'}`}>
              <p className={`text-3xl font-bold ${stats.discrepancies.stained > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                {stats.discrepancies.stained}
              </p>
              <p className="text-sm text-gray-600 mt-1">Lekeli Urunler</p>
            </div>
            <div className={`p-4 rounded-lg ${stats.discrepancies.highWashCount > 0 ? 'bg-yellow-50' : 'bg-gray-50'}`}>
              <p className={`text-3xl font-bold ${stats.discrepancies.highWashCount > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>
                {stats.discrepancies.highWashCount}
              </p>
              <p className="text-sm text-gray-600 mt-1">Yuksek Yikama (50+)</p>
            </div>
            <div className="p-4 rounded-lg bg-purple-50">
              <p className="text-3xl font-bold text-purple-600">{stats.pickupDeliveryStats.itemsAtLaundry}</p>
              <p className="text-sm text-gray-600 mt-1">Suanda Disarida</p>
            </div>
          </div>
        </div>
      </div>

      {/* Item Age & Wash Count Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Item Age */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-gray-500" />
            Urun Yas Dagilimi
          </h2>
          <div className="space-y-3">
            <div className="flex items-center">
              <span className="w-32 text-sm text-gray-600">Yeni (0-30 gun)</span>
              <div className="flex-1 bg-gray-200 rounded-full h-6 mx-3">
                <div
                  className="bg-green-500 h-6 rounded-full flex items-center justify-end pr-2"
                  style={{ width: `${stats.totalItems > 0 ? (stats.ageDistribution.new / stats.totalItems) * 100 : 0}%` }}
                >
                  <span className="text-white text-xs font-bold">{stats.ageDistribution.new}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center">
              <span className="w-32 text-sm text-gray-600">Orta (31-90)</span>
              <div className="flex-1 bg-gray-200 rounded-full h-6 mx-3">
                <div
                  className="bg-blue-500 h-6 rounded-full flex items-center justify-end pr-2"
                  style={{ width: `${stats.totalItems > 0 ? (stats.ageDistribution.moderate / stats.totalItems) * 100 : 0}%` }}
                >
                  <span className="text-white text-xs font-bold">{stats.ageDistribution.moderate}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center">
              <span className="w-32 text-sm text-gray-600">Eski (91-180)</span>
              <div className="flex-1 bg-gray-200 rounded-full h-6 mx-3">
                <div
                  className="bg-yellow-500 h-6 rounded-full flex items-center justify-end pr-2"
                  style={{ width: `${stats.totalItems > 0 ? (stats.ageDistribution.old / stats.totalItems) * 100 : 0}%` }}
                >
                  <span className="text-white text-xs font-bold">{stats.ageDistribution.old}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center">
              <span className="w-32 text-sm text-gray-600">Cok Eski (180+)</span>
              <div className="flex-1 bg-gray-200 rounded-full h-6 mx-3">
                <div
                  className="bg-red-500 h-6 rounded-full flex items-center justify-end pr-2"
                  style={{ width: `${stats.totalItems > 0 ? (stats.ageDistribution.veryOld / stats.totalItems) * 100 : 0}%` }}
                >
                  <span className="text-white text-xs font-bold">{stats.ageDistribution.veryOld}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Wash Count Distribution */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Droplets className="w-5 h-5 text-blue-500" />
            Yikama Sayisi Dagilimi
          </h2>
          <div className="space-y-3">
            <div className="flex items-center">
              <span className="w-32 text-sm text-gray-600">Dusuk (0-10)</span>
              <div className="flex-1 bg-gray-200 rounded-full h-6 mx-3">
                <div
                  className="bg-green-500 h-6 rounded-full flex items-center justify-end pr-2"
                  style={{ width: `${stats.totalItems > 0 ? (stats.washCountDistribution.low / stats.totalItems) * 100 : 0}%` }}
                >
                  <span className="text-white text-xs font-bold">{stats.washCountDistribution.low}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center">
              <span className="w-32 text-sm text-gray-600">Orta (11-30)</span>
              <div className="flex-1 bg-gray-200 rounded-full h-6 mx-3">
                <div
                  className="bg-blue-500 h-6 rounded-full flex items-center justify-end pr-2"
                  style={{ width: `${stats.totalItems > 0 ? (stats.washCountDistribution.moderate / stats.totalItems) * 100 : 0}%` }}
                >
                  <span className="text-white text-xs font-bold">{stats.washCountDistribution.moderate}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center">
              <span className="w-32 text-sm text-gray-600">Yuksek (31-50)</span>
              <div className="flex-1 bg-gray-200 rounded-full h-6 mx-3">
                <div
                  className="bg-yellow-500 h-6 rounded-full flex items-center justify-end pr-2"
                  style={{ width: `${stats.totalItems > 0 ? (stats.washCountDistribution.high / stats.totalItems) * 100 : 0}%` }}
                >
                  <span className="text-white text-xs font-bold">{stats.washCountDistribution.high}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center">
              <span className="w-32 text-sm text-gray-600">Degistir (50+)</span>
              <div className="flex-1 bg-gray-200 rounded-full h-6 mx-3">
                <div
                  className="bg-red-500 h-6 rounded-full flex items-center justify-end pr-2"
                  style={{ width: `${stats.totalItems > 0 ? (stats.washCountDistribution.veryHigh / stats.totalItems) * 100 : 0}%` }}
                >
                  <span className="text-white text-xs font-bold">{stats.washCountDistribution.veryHigh}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Items by Type */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Tag className="w-5 h-5 text-teal-500" />
          Urun Turleri
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Urun Turu</th>
                <th className="text-center py-3 px-4 text-sm font-semibold text-gray-600">Toplam</th>
                <th className="text-center py-3 px-4 text-sm font-semibold text-gray-600">Otelde</th>
                <th className="text-center py-3 px-4 text-sm font-semibold text-gray-600">Camasirhanede</th>
                <th className="text-center py-3 px-4 text-sm font-semibold text-gray-600">Yolda</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(stats.itemsByType).map(([typeName, data]) => (
                <tr key={typeName} className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 font-medium">{typeName}</td>
                  <td className="py-3 px-4 text-center">
                    <span className="px-3 py-1 bg-gray-100 rounded-full font-semibold">{data.total}</span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full">{data.atHotel}</span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full">{data.atLaundry}</span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full">{data.inTransit}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Items Needing Attention */}
      {stats.attentionItems && stats.attentionItems.length > 0 && (
        <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-orange-200">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            Dikkat Gerektiren Urunler
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-orange-50">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">RFID Etiketi</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Tur</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Durum</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-gray-600">Yikama Sayisi</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-gray-600">Yas (gun)</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Sorunlar</th>
                </tr>
              </thead>
              <tbody>
                {stats.attentionItems.map((item) => (
                  <tr key={item.id} className="border-b hover:bg-orange-50">
                    <td className="py-3 px-4 font-mono text-sm">{item.rfidTag}</td>
                    <td className="py-3 px-4">{item.itemType}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-1 bg-gray-100 rounded text-sm capitalize">
                        {item.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center font-semibold">{item.washCount}</td>
                    <td className="py-3 px-4 text-center">{item.ageInDays}</td>
                    <td className="py-3 px-4">
                      <div className="flex gap-1 flex-wrap">
                        {item.isDamaged && <span className="px-2 py-0.5 text-xs bg-red-100 text-red-800 rounded">Hasarli</span>}
                        {item.isStained && <span className="px-2 py-0.5 text-xs bg-orange-100 text-orange-800 rounded">Lekeli</span>}
                        {item.washCount > 50 && <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded">Degisim Gerekli</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
