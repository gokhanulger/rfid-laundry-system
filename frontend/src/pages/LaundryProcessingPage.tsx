import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, CheckCircle, RefreshCw, AlertTriangle, Search } from 'lucide-react';
import { itemsApi, settingsApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import type { Item } from '../types';

export function LaundryProcessingPage() {
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterHotel, setFilterHotel] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: dirtyItems, isLoading, refetch } = useQuery({
    queryKey: ['dirty-items'],
    queryFn: () => itemsApi.getDirty(),
  });

  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: settingsApi.getTenants,
  });

  const { data: itemTypes } = useQuery({
    queryKey: ['item-types'],
    queryFn: settingsApi.getItemTypes,
  });

  const markCleanMutation = useMutation({
    mutationFn: (itemIds: string[]) => itemsApi.markClean(itemIds),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['dirty-items'] });
      setSelectedItems([]);
      toast.success(`${data.count} urun temiz olarak isaretlendi!`);
    },
    onError: (err) => toast.error('Urunler temiz olarak isaretle islemi basarisiz', getErrorMessage(err)),
  });

  const handleToggleItem = (itemId: string) => {
    setSelectedItems((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId]
    );
  };

  const handleSelectAll = () => {
    if (filteredItems.length === selectedItems.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(filteredItems.map((item: Item) => item.id));
    }
  };

  const handleMarkClean = () => {
    if (selectedItems.length === 0) {
      toast.warning('Lutfen en az bir urun secin');
      return;
    }
    markCleanMutation.mutate(selectedItems);
  };

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const formatDateFull = (dateStr: string) => {
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
      return formatDate(dateStr);
    }
  };

  // Get unique dates for filter
  const uniqueDates = [...new Set((dirtyItems || []).map((item: Item) => {
    const date = new Date(item.updatedAt || item.createdAt);
    return date.toISOString().split('T')[0];
  }))].sort((a, b) => b.localeCompare(a));

  // Filter items
  const filteredItems = (dirtyItems || []).filter((item: Item) => {
    const hotel = tenants?.find((t) => t.id === item.tenantId);
    const itemType = itemTypes?.find((t) => t.id === item.itemTypeId);
    const itemDate = new Date(item.updatedAt || item.createdAt).toISOString().split('T')[0];

    const matchesSearch = searchTerm === '' ||
      item.rfidTag.toLowerCase().includes(searchTerm.toLowerCase()) ||
      hotel?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      itemType?.name.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesHotel = filterHotel === '' || item.tenantId === filterHotel;
    const matchesType = filterType === '' || item.itemTypeId === filterType;
    const matchesDate = filterDate === '' || itemDate === filterDate;

    return matchesSearch && matchesHotel && matchesType && matchesDate;
  });

  // Sort by date descending
  const sortedItems = [...filteredItems].sort((a, b) => {
    const dateA = new Date(a.updatedAt || a.createdAt).getTime();
    const dateB = new Date(b.updatedAt || b.createdAt).getTime();
    return dateB - dateA;
  });

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      at_hotel: 'bg-blue-100 text-blue-800',
      at_laundry: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-orange-100 text-orange-800',
      ready_for_delivery: 'bg-green-100 text-green-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  // Get unique hotels count
  const uniqueHotels = new Set((dirtyItems || []).map((item: Item) => item.tenantId)).size;

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-green-100 rounded-lg">
            <Sparkles className="w-8 h-8 text-green-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Gelen Kirli Urunler</h1>
            <p className="text-gray-500">Kirli urunleri isle ve temiz olarak isaretle</p>
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
            onClick={handleMarkClean}
            disabled={selectedItems.length === 0 || markCleanMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            <CheckCircle className="w-5 h-5" />
            {markCleanMutation.isPending
              ? 'Isleniyor...'
              : `${selectedItems.length} Urunu Temiz Isaretle`}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-3xl font-bold text-purple-600">{uniqueDates.length}</p>
          <p className="text-sm text-gray-500">Farkli Gun</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-3xl font-bold text-blue-600">{dirtyItems?.length || 0}</p>
          <p className="text-sm text-gray-500">Toplam Kirli Urun</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-3xl font-bold text-green-600">{selectedItems.length}</p>
          <p className="text-sm text-gray-500">Secili</p>
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
                placeholder="RFID, otel veya urun tipi ara..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
          </div>

          {/* Date Filter */}
          <select
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
          >
            <option value="">Tum Tarihler</option>
            {uniqueDates.map(date => (
              <option key={date} value={date}>{formatDateFull(date)}</option>
            ))}
          </select>

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

          {/* Type Filter */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
          >
            <option value="">Tum Tipler</option>
            {itemTypes?.map(type => (
              <option key={type.id} value={type.id}>{type.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-lg overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="w-10 h-10 animate-spin text-green-500" />
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="p-16 text-center">
            <Sparkles className="w-20 h-20 mx-auto text-gray-300 mb-4" />
            <p className="text-2xl font-semibold text-gray-500">Islenecek kirli urun yok</p>
            <p className="text-lg text-gray-400 mt-2">Tum urunler temiz!</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b-2 border-gray-200">
                <tr>
                  <th className="px-4 py-4 text-left">
                    <input
                      type="checkbox"
                      checked={sortedItems.length > 0 && selectedItems.length === sortedItems.length}
                      onChange={handleSelectAll}
                      className="w-5 h-5 text-green-600 rounded focus:ring-green-500"
                    />
                  </th>
                  <th className="px-4 py-4 text-left text-sm font-bold text-gray-700 uppercase tracking-wider">
                    Tarih
                  </th>
                  <th className="px-4 py-4 text-left text-sm font-bold text-gray-700 uppercase tracking-wider">
                    Otel
                  </th>
                  <th className="px-4 py-4 text-left text-sm font-bold text-gray-700 uppercase tracking-wider">
                    Urun Tipi
                  </th>
                  <th className="px-4 py-4 text-left text-sm font-bold text-gray-700 uppercase tracking-wider">
                    RFID Etiketi
                  </th>
                  <th className="px-4 py-4 text-left text-sm font-bold text-gray-700 uppercase tracking-wider">
                    Durum
                  </th>
                  <th className="px-4 py-4 text-left text-sm font-bold text-gray-700 uppercase tracking-wider">
                    Yikama
                  </th>
                  <th className="px-4 py-4 text-left text-sm font-bold text-gray-700 uppercase tracking-wider">
                    Isaretler
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedItems.map((item) => {
                  const hotel = tenants?.find((t) => t.id === item.tenantId);
                  const itemType = itemTypes?.find((t) => t.id === item.itemTypeId);
                  const isSelected = selectedItems.includes(item.id);

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-green-50 cursor-pointer transition-colors ${
                        isSelected ? 'bg-green-100' : ''
                      }`}
                      onClick={() => handleToggleItem(item.id)}
                    >
                      <td className="px-4 py-4">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleItem(item.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-5 h-5 text-green-600 rounded focus:ring-green-500"
                        />
                      </td>
                      <td className="px-4 py-4">
                        <div className="text-sm font-medium text-gray-900">
                          {formatDateFull(item.updatedAt || item.createdAt)}
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(item.updatedAt || item.createdAt).toLocaleTimeString('tr-TR', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="text-sm font-semibold text-gray-900">
                          {hotel?.name || 'Bilinmeyen'}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className="px-3 py-1 bg-gray-100 text-gray-800 rounded-full text-sm font-medium">
                          {itemType?.name || 'Bilinmeyen'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span className="font-mono text-sm font-semibold text-gray-900">
                          {item.rfidTag}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`px-2 py-1 text-xs rounded-full font-medium ${getStatusColor(item.status)}`}>
                          {item.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-sm font-bold text-gray-700">
                          {item.washCount}x
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex gap-2">
                          {item.isDamaged && (
                            <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs flex items-center gap-1 font-medium">
                              <AlertTriangle className="w-3 h-3" />
                              Hasarli
                            </span>
                          )}
                          {item.isStained && (
                            <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">
                              Lekeli
                            </span>
                          )}
                          {!item.isDamaged && !item.isStained && (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Table Footer */}
        {sortedItems.length > 0 && (
          <div className="px-6 py-4 bg-gray-50 border-t flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Toplam <span className="font-bold">{sortedItems.length}</span> urun gosteriliyor
              {selectedItems.length > 0 && (
                <span className="ml-2">
                  (<span className="font-bold text-green-600">{selectedItems.length}</span> secili)
                </span>
              )}
            </div>
            <div className="flex gap-2">
              {selectedItems.length > 0 && (
                <button
                  onClick={() => setSelectedItems([])}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg text-sm"
                >
                  Secimi Temizle
                </button>
              )}
              <button
                onClick={handleSelectAll}
                className="px-4 py-2 text-green-600 hover:bg-green-50 rounded-lg text-sm font-medium"
              >
                {selectedItems.length === sortedItems.length ? 'Tum Secimleri Kaldir' : 'Tumu Sec'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
