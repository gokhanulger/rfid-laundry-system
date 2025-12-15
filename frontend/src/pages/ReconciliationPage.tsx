import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownCircle,
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Package,
  Building2,
  Filter,
  Truck,
  Search,
} from 'lucide-react';
import api, { settingsApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Tenant } from '../types';

interface ReconciliationData {
  startDate: string;
  endDate: string;
  summary: {
    totalPickedUp: number;
    totalDelivered: number;
    pendingReturn: number;
    atLaundry: number;
    inProcessing: number;
    readyForDelivery: number;
    inTransit: number;
    potentiallyMissing: number;
  };
  atLaundry: CategoryData;
  inProcessing: CategoryData;
  readyForDelivery: CategoryData;
  inTransit: CategoryData;
  missing: CategoryData;
  allPickedUp: { count: number; byType: Record<string, number> };
  allDelivered: { count: number; byType: Record<string, number> };
}

interface CategoryData {
  count: number;
  byType: Record<string, number>;
  byHotel: Array<{
    hotel: { id: string; name: string };
    items: any[];
    byType: Record<string, number>;
  }>;
  items: any[];
}

export function ReconciliationPage() {
  const { user } = useAuth();
  const isHotelOwner = user?.role === 'hotel_owner';

  // Date range - default to last 30 days
  const today = new Date();
  const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [startDate, setStartDate] = useState(monthAgo.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(today.toISOString().split('T')[0]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    missing: true,
    atLaundry: true,
  });
  const [expandedHotels, setExpandedHotels] = useState<Record<string, boolean>>({});

  // Fetch tenants for filter (not for hotel owners)
  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: settingsApi.getTenants,
    enabled: !isHotelOwner,
  });

  // Fetch reconciliation data
  const { data, isLoading, error, refetch } = useQuery({
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

  // Handle errors
  if (error) {
    console.error('Reconciliation error:', error);
  }

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleHotel = (hotelId: string) => {
    setExpandedHotels(prev => ({ ...prev, [hotelId]: !prev[hotelId] }));
  };

  // Quick date presets
  const setPreset = (days: number) => {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'short',
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'at_laundry': return 'bg-yellow-100 text-yellow-800';
      case 'processing': return 'bg-blue-100 text-blue-800';
      case 'ready_for_delivery': return 'bg-green-100 text-green-800';
      case 'label_printed': return 'bg-green-100 text-green-800';
      case 'packaged': return 'bg-green-100 text-green-800';
      case 'in_transit': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'at_laundry': return 'Camasirhanede';
      case 'processing': return 'Isleniyor';
      case 'ready_for_delivery': return 'Teslimata Hazir';
      case 'label_printed': return 'Etiket Basildi';
      case 'packaged': return 'Paketlendi';
      case 'in_transit': return 'Yolda';
      default: return status;
    }
  };

  // Render a category section
  const renderCategorySection = (
    title: string,
    icon: React.ReactNode,
    categoryData: CategoryData | undefined,
    colorClass: string,
    sectionKey: string
  ) => {
    if (!categoryData || categoryData.count === 0) return null;

    const isExpanded = expandedSections[sectionKey];
    const byHotel = categoryData.byHotel || [];
    const byType = categoryData.byType || {};

    return (
      <div className={`bg-white rounded-xl shadow-lg border-l-4 ${colorClass} overflow-hidden`}>
        <button
          onClick={() => toggleSection(sectionKey)}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50"
        >
          <div className="flex items-center gap-3">
            {icon}
            <div className="text-left">
              <h3 className="font-semibold text-gray-900">{title}</h3>
              <p className="text-sm text-gray-500">
                {byHotel.length} otel, {Object.keys(byType).length} urun tipi
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-2xl font-bold text-gray-900">{categoryData.count}</span>
            {isExpanded ? (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronRight className="w-5 h-5 text-gray-400" />
            )}
          </div>
        </button>

        {isExpanded && (
          <div className="px-6 pb-4 space-y-4">
            {/* Type summary */}
            <div className="flex flex-wrap gap-2">
              {Object.entries(byType).map(([type, count]) => (
                <span key={type} className="px-3 py-1 bg-gray-100 rounded-full text-sm">
                  {type}: <span className="font-semibold">{count}</span>
                </span>
              ))}
            </div>

            {/* By hotel */}
            <div className="space-y-2">
              {byHotel.map((hotelData) => {
                const hotelExpanded = expandedHotels[`${sectionKey}-${hotelData.hotel.id}`];
                return (
                  <div key={hotelData.hotel.id} className="border rounded-lg">
                    <button
                      onClick={() => toggleHotel(`${sectionKey}-${hotelData.hotel.id}`)}
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-2">
                        {hotelExpanded ? (
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        )}
                        <Building2 className="w-4 h-4 text-gray-500" />
                        <span className="font-medium">{hotelData.hotel.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex gap-1">
                          {Object.entries(hotelData.byType).slice(0, 3).map(([type, count]) => (
                            <span key={type} className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                              {type}: {count}
                            </span>
                          ))}
                        </div>
                        <span className="font-semibold text-gray-900">{hotelData.items.length} urun</span>
                      </div>
                    </button>

                    {hotelExpanded && (
                      <div className="px-4 pb-3 border-t">
                        <table className="w-full text-sm mt-2">
                          <thead>
                            <tr className="text-left text-gray-500">
                              <th className="py-2">RFID</th>
                              <th className="py-2">Tur</th>
                              <th className="py-2">Toplama Tarihi</th>
                              <th className="py-2">Gun</th>
                              <th className="py-2">Durum</th>
                            </tr>
                          </thead>
                          <tbody>
                            {hotelData.items.slice(0, 50).map((item: any) => (
                              <tr key={item.id} className="border-t border-gray-100">
                                <td className="py-2 font-mono text-xs">{item.rfidTag}</td>
                                <td className="py-2">{item.itemType?.name || 'Bilinmeyen'}</td>
                                <td className="py-2">{item.pickupDate ? formatDate(item.pickupDate) : '-'}</td>
                                <td className="py-2">
                                  {item.daysSincePickup !== undefined && (
                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                      item.daysSincePickup > 5 ? 'bg-red-100 text-red-700' :
                                      item.daysSincePickup > 3 ? 'bg-orange-100 text-orange-700' :
                                      'bg-gray-100 text-gray-700'
                                    }`}>
                                      {item.daysSincePickup} gun
                                    </span>
                                  )}
                                </td>
                                <td className="py-2">
                                  <span className={`px-2 py-0.5 rounded text-xs ${getStatusColor(item.currentStatus || item.status)}`}>
                                    {getStatusLabel(item.currentStatus || item.status)}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {hotelData.items.length > 50 && (
                          <p className="text-sm text-gray-500 mt-2">
                            ... ve {hotelData.items.length - 50} urun daha
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-100 rounded-lg">
            <Search className="w-8 h-8 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Mutabakat</h1>
            <p className="text-gray-500">Kayip ve eksik urunleri tespit edin</p>
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

          {/* Hotel Filter */}
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
      {data && (
        <div className={`grid grid-cols-2 ${isHotelOwner ? 'md:grid-cols-3' : 'md:grid-cols-4'} gap-4`}>
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <ArrowDownCircle className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-orange-600">
                  {data.summary.totalPickedUp}
                </p>
                <p className="text-sm text-gray-500">Toplanan</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-green-600">
                  {data.summary.totalDelivered}
                </p>
                <p className="text-sm text-gray-500">Teslim Edilen</p>
              </div>
            </div>
          </div>
          {!isHotelOwner && (
            <div className="bg-white rounded-xl shadow p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-yellow-100 rounded-lg">
                  <Clock className="w-6 h-6 text-yellow-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-yellow-600">
                    {data.summary.pendingReturn}
                  </p>
                  <p className="text-sm text-gray-500">Bekleyen</p>
                </div>
              </div>
            </div>
          )}
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-lg">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-red-600">
                  {data.summary.potentiallyMissing}
                </p>
                <p className="text-sm text-gray-500">Kayip/Sorunlu</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Flow Visualization */}
      {data && (
        <div className="bg-gradient-to-r from-orange-50 via-gray-50 to-green-50 rounded-xl p-6">
          <h3 className="font-semibold text-gray-900 mb-4 text-center">Urun Akisi</h3>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <div className="text-center p-4 bg-white rounded-lg shadow">
              <ArrowDownCircle className="w-8 h-8 text-orange-500 mx-auto mb-2" />
              <p className="text-2xl font-bold text-orange-600">{data.summary.totalPickedUp}</p>
              <p className="text-xs text-gray-500">Otel'den Alindi</p>
            </div>
            <div className="text-2xl text-gray-300">→</div>
            <div className="text-center p-4 bg-white rounded-lg shadow">
              <Package className="w-8 h-8 text-yellow-500 mx-auto mb-2" />
              <p className="text-2xl font-bold text-yellow-600">{data.summary.atLaundry}</p>
              <p className="text-xs text-gray-500">Camasirhanede</p>
            </div>
            {!isHotelOwner && (
              <>
                <div className="text-2xl text-gray-300">→</div>
                <div className="text-center p-4 bg-white rounded-lg shadow">
                  <Clock className="w-8 h-8 text-blue-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-blue-600">{data.summary.inProcessing}</p>
                  <p className="text-xs text-gray-500">Isleniyor</p>
                </div>
                <div className="text-2xl text-gray-300">→</div>
                <div className="text-center p-4 bg-white rounded-lg shadow">
                  <Package className="w-8 h-8 text-green-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-green-600">{data.summary.readyForDelivery}</p>
                  <p className="text-xs text-gray-500">Hazir</p>
                </div>
                <div className="text-2xl text-gray-300">→</div>
                <div className="text-center p-4 bg-white rounded-lg shadow">
                  <Truck className="w-8 h-8 text-purple-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-purple-600">{data.summary.inTransit}</p>
                  <p className="text-xs text-gray-500">Yolda</p>
                </div>
              </>
            )}
            <div className="text-2xl text-gray-300">→</div>
            <div className="text-center p-4 bg-white rounded-lg shadow">
              <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
              <p className="text-2xl font-bold text-green-600">{data.summary.totalDelivered}</p>
              <p className="text-xs text-gray-500">Teslim Edildi</p>
            </div>
          </div>
          {data.summary.potentiallyMissing > 0 && (
            <div className="mt-4 text-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-100 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <span className="font-semibold text-red-600">
                  {data.summary.potentiallyMissing} urun kayip/sorunlu!
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center h-64 bg-white rounded-xl shadow">
          <RefreshCw className="w-10 h-10 animate-spin text-indigo-500" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-700 font-medium">Veri yuklenirken hata olustu</p>
          <p className="text-red-600 text-sm mt-2">{(error as Error).message}</p>
          <button
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
          >
            Tekrar Dene
          </button>
        </div>
      )}

      {/* Category Sections */}
      {data && (
        <div className="space-y-4">
          {/* Missing Items - Most Important */}
          {renderCategorySection(
            'Kayip / Sorunlu Urunler',
            <AlertTriangle className="w-6 h-6 text-red-500" />,
            data.missing,
            'border-red-500',
            'missing'
          )}

          {/* At Laundry */}
          {renderCategorySection(
            'Camasirhanede Bekleyen',
            <Package className="w-6 h-6 text-yellow-500" />,
            data.atLaundry,
            'border-yellow-500',
            'atLaundry'
          )}

          {/* In Processing - Hide for hotel owners */}
          {!isHotelOwner && renderCategorySection(
            'Isleniyor',
            <Clock className="w-6 h-6 text-blue-500" />,
            data.inProcessing,
            'border-blue-500',
            'inProcessing'
          )}

          {/* Ready for Delivery - Hide for hotel owners */}
          {!isHotelOwner && renderCategorySection(
            'Teslimata Hazir',
            <CheckCircle className="w-6 h-6 text-green-500" />,
            data.readyForDelivery,
            'border-green-500',
            'readyForDelivery'
          )}

          {/* In Transit - Hide for hotel owners */}
          {!isHotelOwner && renderCategorySection(
            'Yolda',
            <Truck className="w-6 h-6 text-purple-500" />,
            data.inTransit,
            'border-purple-500',
            'inTransit'
          )}
        </div>
      )}

      {/* Empty State */}
      {data && data.summary.totalPickedUp === 0 && (
        <div className="bg-white rounded-xl shadow p-12 text-center">
          <Search className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-xl text-gray-500">Secilen tarih araliginda toplama bulunamadi</p>
          <p className="text-gray-400 mt-2">Farkli tarih araligi secin veya filtreleri degistirin</p>
        </div>
      )}
    </div>
  );
}
