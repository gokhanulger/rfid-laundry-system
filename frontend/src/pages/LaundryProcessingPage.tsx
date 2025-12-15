import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, CheckCircle, RefreshCw, AlertTriangle, Search, ChevronDown, ChevronUp, Package, Building2, User, Calendar, Tag } from 'lucide-react';
import { pickupsApi, itemsApi, settingsApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import type { Pickup } from '../types';

export function LaundryProcessingPage() {
  const [selectedPickups, setSelectedPickups] = useState<string[]>([]);
  const [expandedPickup, setExpandedPickup] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterHotel, setFilterHotel] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const queryClient = useQueryClient();
  const toast = useToast();

  // Get pickups with status 'received' (at laundry, ready to process)
  const { data: pickupsData, isLoading, refetch } = useQuery({
    queryKey: ['pickups', { status: 'received' }],
    queryFn: () => pickupsApi.getAll({ status: 'received', limit: 100 }),
  });

  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: settingsApi.getTenants,
  });

  const { data: itemTypes } = useQuery({
    queryKey: ['item-types'],
    queryFn: settingsApi.getItemTypes,
  });

  // Mark items as clean (process pickup)
  const processPickupMutation = useMutation({
    mutationFn: async (pickupIds: string[]) => {
      // Get all item IDs from selected pickups
      const itemIds: string[] = [];
      pickupIds.forEach(pickupId => {
        const pickup = pickups.find(p => p.id === pickupId);
        if (pickup?.pickupItems) {
          pickup.pickupItems.forEach(pi => {
            if (pi.itemId) itemIds.push(pi.itemId);
          });
        }
      });

      if (itemIds.length > 0) {
        return itemsApi.markClean(itemIds);
      }
      return { count: 0 };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['pickups'] });
      queryClient.invalidateQueries({ queryKey: ['dirty-items'] });
      setSelectedPickups([]);
      toast.success(`${data.count} urun temiz olarak isaretlendi!`);
    },
    onError: (err) => toast.error('Islem basarisiz', getErrorMessage(err)),
  });

  const pickups = pickupsData?.data || [];

  // Filter pickups
  const filteredPickups = pickups.filter((pickup: Pickup) => {
    const hotel = tenants?.find((t) => t.id === pickup.tenantId);

    const matchesSearch = searchTerm === '' ||
      pickup.bagCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      pickup.sealNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      hotel?.name.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesHotel = filterHotel === '' || pickup.tenantId === filterHotel;

    // Date filter
    const matchesDate = filterDate === '' ||
      new Date(pickup.pickupDate).toISOString().split('T')[0] === filterDate;

    return matchesSearch && matchesHotel && matchesDate;
  });

  // Sort by date descending
  const sortedPickups = [...filteredPickups].sort((a, b) => {
    return new Date(b.pickupDate).getTime() - new Date(a.pickupDate).getTime();
  });

  const handleTogglePickup = (pickupId: string) => {
    setSelectedPickups((prev) =>
      prev.includes(pickupId)
        ? prev.filter((id) => id !== pickupId)
        : [...prev, pickupId]
    );
  };

  const handleSelectAll = () => {
    if (sortedPickups.length === selectedPickups.length) {
      setSelectedPickups([]);
    } else {
      setSelectedPickups(sortedPickups.map((p: Pickup) => p.id));
    }
  };

  const handleProcessSelected = () => {
    if (selectedPickups.length === 0) {
      toast.warning('Lutfen en az bir toplama secin');
      return;
    }
    processPickupMutation.mutate(selectedPickups);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const dateOnly = date.toISOString().split('T')[0];
    const todayOnly = today.toISOString().split('T')[0];
    const yesterdayOnly = yesterday.toISOString().split('T')[0];

    if (dateOnly === todayOnly) {
      return 'Bugun';
    } else if (dateOnly === yesterdayOnly) {
      return 'Dun';
    } else {
      return date.toLocaleDateString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    }
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Get item counts by type for a pickup
  const getItemSummary = (pickup: Pickup) => {
    const summary: Record<string, { name: string; count: number; damaged: number; stained: number }> = {};

    pickup.pickupItems?.forEach(pi => {
      const item = pi.item;
      if (item) {
        const typeId = item.itemTypeId;
        const typeName = itemTypes?.find(t => t.id === typeId)?.name || 'Bilinmeyen';

        if (!summary[typeId]) {
          summary[typeId] = { name: typeName, count: 0, damaged: 0, stained: 0 };
        }
        summary[typeId].count++;
        if (item.isDamaged) summary[typeId].damaged++;
        if (item.isStained) summary[typeId].stained++;
      }
    });

    return Object.values(summary);
  };

  // Get unique hotels count
  const uniqueHotels = new Set(pickups.map((p: Pickup) => p.tenantId)).size;
  const totalItems = pickups.reduce((sum: number, p: Pickup) => sum + (p.pickupItems?.length || 0), 0);

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-green-100 rounded-lg">
            <Sparkles className="w-8 h-8 text-green-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Gelen Kirli Toplamalar</h1>
            <p className="text-gray-500">Surucu toplamalarini isle ve temiz olarak isaretle</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <RefreshCw className="w-4 h-4" />
            Yenile
          </button>
          <button
            onClick={handleProcessSelected}
            disabled={selectedPickups.length === 0 || processPickupMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            <CheckCircle className="w-5 h-5" />
            {processPickupMutation.isPending
              ? 'Isleniyor...'
              : `${selectedPickups.length} Toplamayi Isaretle`}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-3xl font-bold text-purple-600">{pickups.length}</p>
          <p className="text-sm text-gray-500">Toplam Toplama</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-3xl font-bold text-blue-600">{totalItems}</p>
          <p className="text-sm text-gray-500">Toplam Urun</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-3xl font-bold text-green-600">{selectedPickups.length}</p>
          <p className="text-sm text-gray-500">Secili Toplama</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-3xl font-bold text-orange-600">{uniqueHotels}</p>
          <p className="text-sm text-gray-500">Farkli Otel</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-lg p-4">
        <div className="flex flex-wrap gap-4">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Canta kodu, muhr no veya otel ara..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
          </div>

          {/* Hotel Filter */}
          <select
            value={filterHotel}
            onChange={(e) => setFilterHotel(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
          >
            <option value="">Tum Oteller</option>
            {tenants?.map(tenant => (
              <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
            ))}
          </select>

          {/* Date Filter */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
            {filterDate && (
              <button
                onClick={() => setFilterDate('')}
                className="px-3 py-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
                title="Tarihi temizle"
              >
                &times;
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Pickups Table */}
      <div className="bg-white rounded-xl shadow-lg overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="w-10 h-10 animate-spin text-green-500" />
          </div>
        ) : sortedPickups.length === 0 ? (
          <div className="p-16 text-center">
            <Sparkles className="w-20 h-20 mx-auto text-gray-300 mb-4" />
            <p className="text-2xl font-semibold text-gray-500">Islenecek toplama yok</p>
            <p className="text-lg text-gray-400 mt-2">Tum toplamalar islendi!</p>
          </div>
        ) : (
          <div>
            {/* Table Header */}
            <div className="bg-gray-50 border-b-2 border-gray-200 px-6 py-4">
              <div className="flex items-center gap-4">
                <input
                  type="checkbox"
                  checked={sortedPickups.length > 0 && selectedPickups.length === sortedPickups.length}
                  onChange={handleSelectAll}
                  className="w-5 h-5 text-green-600 rounded focus:ring-green-500"
                />
                <div className="flex-1 grid grid-cols-6 gap-4 text-sm font-bold text-gray-700 uppercase tracking-wider">
                  <span>Tarih</span>
                  <span>Otel</span>
                  <span>Canta / Muhur</span>
                  <span>Urun Sayisi</span>
                  <span>Surucu</span>
                  <span>Detay</span>
                </div>
              </div>
            </div>

            {/* Table Body */}
            <div className="divide-y divide-gray-100">
              {sortedPickups.map((pickup: Pickup) => {
                const hotel = tenants?.find((t) => t.id === pickup.tenantId);
                const isSelected = selectedPickups.includes(pickup.id);
                const isExpanded = expandedPickup === pickup.id;
                const itemSummary = getItemSummary(pickup);
                const totalItems = pickup.pickupItems?.length || 0;
                const damagedCount = pickup.pickupItems?.filter(pi => pi.item?.isDamaged).length || 0;
                const stainedCount = pickup.pickupItems?.filter(pi => pi.item?.isStained).length || 0;

                return (
                  <div key={pickup.id}>
                    {/* Row */}
                    <div
                      className={`px-6 py-4 hover:bg-green-50 cursor-pointer transition-colors ${
                        isSelected ? 'bg-green-100' : ''
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleTogglePickup(pickup.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-5 h-5 text-green-600 rounded focus:ring-green-500"
                        />
                        <div
                          className="flex-1 grid grid-cols-6 gap-4 items-center"
                          onClick={() => handleTogglePickup(pickup.id)}
                        >
                          {/* Date */}
                          <div>
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4 text-gray-400" />
                              <span className="font-medium text-gray-900">{formatDate(pickup.pickupDate)}</span>
                            </div>
                            <span className="text-xs text-gray-500 ml-6">{formatTime(pickup.pickupDate)}</span>
                          </div>

                          {/* Hotel */}
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-blue-500" />
                            <span className="font-semibold text-gray-900">{hotel?.name || 'Bilinmeyen'}</span>
                          </div>

                          {/* Bag / Seal */}
                          <div>
                            <div className="font-mono text-sm font-semibold text-gray-900">{pickup.bagCode}</div>
                            <div className="text-xs text-gray-500">Muhur: {pickup.sealNumber}</div>
                          </div>

                          {/* Item Count */}
                          <div>
                            <span className="text-2xl font-bold text-green-600">{totalItems}</span>
                            <span className="text-sm text-gray-500 ml-1">urun</span>
                            {(damagedCount > 0 || stainedCount > 0) && (
                              <div className="flex gap-1 mt-1">
                                {damagedCount > 0 && (
                                  <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs">
                                    {damagedCount} hasarli
                                  </span>
                                )}
                                {stainedCount > 0 && (
                                  <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs">
                                    {stainedCount} lekeli
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Driver */}
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-gray-400" />
                            <span className="text-sm text-gray-700">{pickup.driver ? `${pickup.driver.firstName} ${pickup.driver.lastName}` : '-'}</span>
                          </div>

                          {/* Expand Button */}
                          <div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedPickup(isExpanded ? null : pickup.id);
                              }}
                              className="flex items-center gap-1 px-3 py-1.5 text-sm text-green-600 hover:bg-green-100 rounded-lg transition-colors"
                            >
                              {isExpanded ? (
                                <>
                                  <ChevronUp className="w-4 h-4" />
                                  Gizle
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="w-4 h-4" />
                                  Detay
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="bg-gray-50 border-t border-gray-200 px-6 py-4">
                        <div className="grid grid-cols-2 gap-6">
                          {/* Item Summary by Type */}
                          <div>
                            <h4 className="text-sm font-bold text-gray-700 uppercase mb-3 flex items-center gap-2">
                              <Package className="w-4 h-4" />
                              Urun Ozeti
                            </h4>
                            <div className="bg-white rounded-lg border overflow-hidden">
                              <table className="w-full">
                                <thead className="bg-gray-100">
                                  <tr>
                                    <th className="px-4 py-2 text-left text-xs font-bold text-gray-600">Tip</th>
                                    <th className="px-4 py-2 text-center text-xs font-bold text-gray-600">Adet</th>
                                    <th className="px-4 py-2 text-center text-xs font-bold text-gray-600">Hasarli</th>
                                    <th className="px-4 py-2 text-center text-xs font-bold text-gray-600">Lekeli</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {itemSummary.map((item, idx) => (
                                    <tr key={idx}>
                                      <td className="px-4 py-2">
                                        <span className="flex items-center gap-2">
                                          <Tag className="w-4 h-4 text-green-500" />
                                          {item.name}
                                        </span>
                                      </td>
                                      <td className="px-4 py-2 text-center font-bold">{item.count}</td>
                                      <td className="px-4 py-2 text-center">
                                        {item.damaged > 0 ? (
                                          <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">
                                            {item.damaged}
                                          </span>
                                        ) : (
                                          <span className="text-gray-400">-</span>
                                        )}
                                      </td>
                                      <td className="px-4 py-2 text-center">
                                        {item.stained > 0 ? (
                                          <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">
                                            {item.stained}
                                          </span>
                                        ) : (
                                          <span className="text-gray-400">-</span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot className="bg-gray-50">
                                  <tr>
                                    <td className="px-4 py-2 font-bold">TOPLAM</td>
                                    <td className="px-4 py-2 text-center font-bold text-green-600">{totalItems}</td>
                                    <td className="px-4 py-2 text-center font-bold text-red-600">{damagedCount || '-'}</td>
                                    <td className="px-4 py-2 text-center font-bold text-yellow-600">{stainedCount || '-'}</td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </div>

                          {/* Individual Items */}
                          <div>
                            <h4 className="text-sm font-bold text-gray-700 uppercase mb-3">
                              Urun Detaylari ({totalItems} urun)
                            </h4>
                            <div className="bg-white rounded-lg border max-h-64 overflow-y-auto">
                              <table className="w-full">
                                <thead className="bg-gray-100 sticky top-0">
                                  <tr>
                                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">RFID</th>
                                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">Tip</th>
                                    <th className="px-3 py-2 text-center text-xs font-bold text-gray-600">Yikama</th>
                                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">Durum</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {pickup.pickupItems?.map((pi) => {
                                    const item = pi.item;
                                    const itemType = itemTypes?.find(t => t.id === item?.itemTypeId);
                                    return (
                                      <tr key={pi.id} className="hover:bg-gray-50">
                                        <td className="px-3 py-2 font-mono text-xs">{item?.rfidTag || '-'}</td>
                                        <td className="px-3 py-2 text-xs">{itemType?.name || '-'}</td>
                                        <td className="px-3 py-2 text-center text-xs font-medium">{item?.washCount || 0}x</td>
                                        <td className="px-3 py-2">
                                          <div className="flex gap-1">
                                            {item?.isDamaged && (
                                              <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs flex items-center gap-0.5">
                                                <AlertTriangle className="w-3 h-3" />
                                                Hasarli
                                              </span>
                                            )}
                                            {item?.isStained && (
                                              <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs">
                                                Lekeli
                                              </span>
                                            )}
                                            {!item?.isDamaged && !item?.isStained && (
                                              <span className="text-xs text-gray-400">Normal</span>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>

                        {/* Notes */}
                        {pickup.notes && (
                          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                            <p className="text-sm text-yellow-800">
                              <strong>Not:</strong> {pickup.notes}
                            </p>
                          </div>
                        )}

                        {/* Quick Action */}
                        <div className="mt-4 flex justify-end">
                          <button
                            onClick={() => {
                              setSelectedPickups([pickup.id]);
                              processPickupMutation.mutate([pickup.id]);
                            }}
                            disabled={processPickupMutation.isPending}
                            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400"
                          >
                            <CheckCircle className="w-4 h-4" />
                            Bu Toplamayi Isaretle
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Table Footer */}
            <div className="px-6 py-4 bg-gray-50 border-t flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Toplam <span className="font-bold">{sortedPickups.length}</span> toplama,
                <span className="font-bold ml-1">{totalItems}</span> urun
                {selectedPickups.length > 0 && (
                  <span className="ml-2">
                    (<span className="font-bold text-green-600">{selectedPickups.length}</span> secili)
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {selectedPickups.length > 0 && (
                  <button
                    onClick={() => setSelectedPickups([])}
                    className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg text-sm"
                  >
                    Secimi Temizle
                  </button>
                )}
                <button
                  onClick={handleSelectAll}
                  className="px-4 py-2 text-green-600 hover:bg-green-50 rounded-lg text-sm font-medium"
                >
                  {selectedPickups.length === sortedPickups.length ? 'Tum Secimleri Kaldir' : 'Tumu Sec'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
