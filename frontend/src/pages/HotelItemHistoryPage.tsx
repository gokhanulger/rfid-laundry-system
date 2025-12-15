import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpCircle,
  ArrowDownCircle,
  Calendar,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Tag,
  Package,
  Search,
} from 'lucide-react';
import { pickupsApi, deliveriesApi } from '../lib/api';
import type { Pickup, Delivery, PickupItem, DeliveryItem } from '../types';

type TabType = 'pickups' | 'deliveries';

export function HotelItemHistoryPage() {
  const [activeTab, setActiveTab] = useState<TabType>('pickups');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch pickups
  const { data: pickupsData, isLoading: loadingPickups, refetch: refetchPickups } = useQuery({
    queryKey: ['hotel-pickups'],
    queryFn: () => pickupsApi.getAll({ limit: 200 }),
  });

  // Fetch deliveries (delivered status)
  const { data: deliveriesData, isLoading: loadingDeliveries, refetch: refetchDeliveries } = useQuery({
    queryKey: ['hotel-deliveries-history'],
    queryFn: () => deliveriesApi.getAll({ status: 'delivered', limit: 200 }),
  });

  const isLoading = activeTab === 'pickups' ? loadingPickups : loadingDeliveries;
  const refetch = activeTab === 'pickups' ? refetchPickups : refetchDeliveries;

  const pickups = pickupsData?.data || [];
  const deliveries = deliveriesData?.data || [];

  // Filter by date
  const filterByDate = (dateStr: string) => {
    if (dateFilter === 'all') return true;
    const date = new Date(dateStr);
    const now = new Date();

    if (dateFilter === 'today') {
      return date.toDateString() === now.toDateString();
    }
    if (dateFilter === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return date >= weekAgo;
    }
    if (dateFilter === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return date >= monthAgo;
    }
    return true;
  };

  // Filter by search (RFID tag)
  const filterPickupBySearch = (pickup: Pickup) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    if (pickup.bagCode.toLowerCase().includes(search)) return true;
    return pickup.pickupItems?.some(pi =>
      pi.item?.rfidTag.toLowerCase().includes(search)
    ) || false;
  };

  const filterDeliveryBySearch = (delivery: Delivery) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    if (delivery.barcode.toLowerCase().includes(search)) return true;
    return delivery.deliveryItems?.some(di =>
      di.item?.rfidTag.toLowerCase().includes(search)
    ) || false;
  };

  // Filtered data
  const filteredPickups = pickups
    .filter(p => filterByDate(p.pickupDate || p.createdAt))
    .filter(filterPickupBySearch)
    .sort((a, b) => new Date(b.pickupDate || b.createdAt).getTime() - new Date(a.pickupDate || a.createdAt).getTime());

  const filteredDeliveries = deliveries
    .filter(d => filterByDate(d.deliveredAt || d.createdAt))
    .filter(filterDeliveryBySearch)
    .sort((a, b) => new Date(b.deliveredAt || b.createdAt).getTime() - new Date(a.deliveredAt || a.createdAt).getTime());

  // Group by date
  const groupByDate = <T extends { createdAt: string }>(
    items: T[],
    getDate: (item: T) => string
  ): Record<string, T[]> => {
    return items.reduce((acc, item) => {
      const date = new Date(getDate(item)).toLocaleDateString('tr-TR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      if (!acc[date]) acc[date] = [];
      acc[date].push(item);
      return acc;
    }, {} as Record<string, T[]>);
  };

  const groupedPickups = groupByDate(filteredPickups, p => p.pickupDate || p.createdAt);
  const groupedDeliveries = groupByDate(filteredDeliveries, d => d.deliveredAt || d.createdAt);

  const toggleExpand = (id: string) => {
    const newSet = new Set(expandedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpandedIds(newSet);
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Get item type summary
  const getItemTypeSummary = (items: (PickupItem | DeliveryItem)[]) => {
    const summary: Record<string, number> = {};
    items.forEach(item => {
      const typeName = item.item?.itemType?.name || 'Bilinmeyen';
      summary[typeName] = (summary[typeName] || 0) + 1;
    });
    return summary;
  };

  // Stats
  const totalPickupItems = pickups.reduce((sum, p) => sum + (p.pickupItems?.length || 0), 0);
  const totalDeliveryItems = deliveries.reduce((sum, d) => sum + (d.deliveryItems?.length || 0), 0);

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-100 rounded-lg">
            <Package className="w-8 h-8 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Urun Gecmisi</h1>
            <p className="text-gray-500">Toplanan ve teslim edilen urunlerinizi goruntuleyin</p>
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

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-5 border-l-4 border-orange-500">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 rounded-lg">
              <ArrowUpCircle className="w-6 h-6 text-orange-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{totalPickupItems}</p>
              <p className="text-sm text-gray-500">Toplam Toplanan Urun</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-5 border-l-4 border-green-500">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <ArrowDownCircle className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{totalDeliveryItems}</p>
              <p className="text-sm text-gray-500">Toplam Teslim Edilen Urun</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm">
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('pickups')}
            className={`flex-1 flex items-center justify-center gap-2 px-6 py-4 font-medium transition-colors ${
              activeTab === 'pickups'
                ? 'text-orange-600 border-b-2 border-orange-600 bg-orange-50'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <ArrowUpCircle className="w-5 h-5" />
            Toplanan Urunler
            <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-sm">
              {filteredPickups.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('deliveries')}
            className={`flex-1 flex items-center justify-center gap-2 px-6 py-4 font-medium transition-colors ${
              activeTab === 'deliveries'
                ? 'text-green-600 border-b-2 border-green-600 bg-green-50'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <ArrowDownCircle className="w-5 h-5" />
            Teslim Edilen Urunler
            <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-sm">
              {filteredDeliveries.length}
            </span>
          </button>
        </div>

        {/* Filters */}
        <div className="p-4 border-b bg-gray-50">
          <div className="flex flex-wrap gap-4">
            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="RFID veya barkod ile ara..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Date Filter */}
            <div className="flex gap-2">
              {[
                { value: 'all', label: 'Tumu' },
                { value: 'today', label: 'Bugun' },
                { value: 'week', label: 'Bu Hafta' },
                { value: 'month', label: 'Bu Ay' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setDateFilter(opt.value)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    dateFilter === opt.value
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <RefreshCw className="w-10 h-10 animate-spin text-indigo-500" />
            </div>
          ) : activeTab === 'pickups' ? (
            /* Pickups Tab */
            filteredPickups.length === 0 ? (
              <div className="text-center py-12">
                <ArrowUpCircle className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                <p className="text-xl text-gray-500">Toplama kaydı bulunamadı</p>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedPickups).map(([date, datePickups]) => (
                  <div key={date}>
                    <div className="flex items-center gap-2 mb-3">
                      <Calendar className="w-5 h-5 text-orange-600" />
                      <h3 className="font-semibold text-gray-800">{date}</h3>
                      <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-sm">
                        {datePickups.length} toplama
                      </span>
                    </div>
                    <div className="space-y-2">
                      {datePickups.map((pickup) => {
                        const isExpanded = expandedIds.has(pickup.id);
                        const itemCount = pickup.pickupItems?.length || 0;
                        const typeSummary = getItemTypeSummary(pickup.pickupItems || []);

                        return (
                          <div
                            key={pickup.id}
                            className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden"
                          >
                            <button
                              onClick={() => toggleExpand(pickup.id)}
                              className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-100"
                            >
                              <div className="flex items-center gap-4">
                                {isExpanded ? (
                                  <ChevronDown className="w-5 h-5 text-gray-400" />
                                ) : (
                                  <ChevronRight className="w-5 h-5 text-gray-400" />
                                )}
                                <div className="text-left">
                                  <p className="font-mono font-semibold text-gray-900">
                                    {pickup.bagCode}
                                  </p>
                                  <p className="text-sm text-gray-500">
                                    {formatTime(pickup.pickupDate || pickup.createdAt)}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="flex gap-1 flex-wrap justify-end">
                                  {Object.entries(typeSummary).slice(0, 3).map(([type, count]) => (
                                    <span
                                      key={type}
                                      className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs"
                                    >
                                      {type}: {count}
                                    </span>
                                  ))}
                                </div>
                                <span className="px-3 py-1 bg-orange-500 text-white rounded-full font-bold">
                                  {itemCount} urun
                                </span>
                              </div>
                            </button>

                            {isExpanded && pickup.pickupItems && pickup.pickupItems.length > 0 && (
                              <div className="border-t border-gray-200 bg-white p-4">
                                <p className="text-sm font-semibold text-gray-600 mb-3">
                                  RFID Etiketleri
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                  {pickup.pickupItems.map((pi) => (
                                    <div
                                      key={pi.id}
                                      className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border"
                                    >
                                      <Tag className="w-4 h-4 text-orange-500" />
                                      <span className="font-mono text-sm">{pi.item?.rfidTag || 'N/A'}</span>
                                      <span className="text-xs text-gray-500 ml-auto">
                                        {pi.item?.itemType?.name || ''}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            /* Deliveries Tab */
            filteredDeliveries.length === 0 ? (
              <div className="text-center py-12">
                <ArrowDownCircle className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                <p className="text-xl text-gray-500">Teslimat kaydı bulunamadı</p>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedDeliveries).map(([date, dateDeliveries]) => (
                  <div key={date}>
                    <div className="flex items-center gap-2 mb-3">
                      <Calendar className="w-5 h-5 text-green-600" />
                      <h3 className="font-semibold text-gray-800">{date}</h3>
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-sm">
                        {dateDeliveries.length} teslimat
                      </span>
                    </div>
                    <div className="space-y-2">
                      {dateDeliveries.map((delivery) => {
                        const isExpanded = expandedIds.has(delivery.id);
                        const itemCount = delivery.deliveryItems?.length || 0;
                        const typeSummary = getItemTypeSummary(delivery.deliveryItems || []);

                        return (
                          <div
                            key={delivery.id}
                            className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden"
                          >
                            <button
                              onClick={() => toggleExpand(delivery.id)}
                              className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-100"
                            >
                              <div className="flex items-center gap-4">
                                {isExpanded ? (
                                  <ChevronDown className="w-5 h-5 text-gray-400" />
                                ) : (
                                  <ChevronRight className="w-5 h-5 text-gray-400" />
                                )}
                                <div className="text-left">
                                  <p className="font-mono font-semibold text-gray-900">
                                    {delivery.barcode}
                                  </p>
                                  <p className="text-sm text-gray-500">
                                    {formatTime(delivery.deliveredAt || delivery.createdAt)}
                                    {delivery.packageCount > 1 && (
                                      <span className="ml-2">• {delivery.packageCount} paket</span>
                                    )}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="flex gap-1 flex-wrap justify-end">
                                  {Object.entries(typeSummary).slice(0, 3).map(([type, count]) => (
                                    <span
                                      key={type}
                                      className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs"
                                    >
                                      {type}: {count}
                                    </span>
                                  ))}
                                </div>
                                <span className="px-3 py-1 bg-green-500 text-white rounded-full font-bold">
                                  {itemCount} urun
                                </span>
                              </div>
                            </button>

                            {isExpanded && delivery.deliveryItems && delivery.deliveryItems.length > 0 && (
                              <div className="border-t border-gray-200 bg-white p-4">
                                <p className="text-sm font-semibold text-gray-600 mb-3">
                                  RFID Etiketleri
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                  {delivery.deliveryItems.map((di) => (
                                    <div
                                      key={di.id}
                                      className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border"
                                    >
                                      <Tag className="w-4 h-4 text-green-500" />
                                      <span className="font-mono text-sm">{di.item?.rfidTag || 'N/A'}</span>
                                      <span className="text-xs text-gray-500 ml-auto">
                                        {di.item?.itemType?.name || ''}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
