import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, CheckCircle, RefreshCw, AlertTriangle, Tag } from 'lucide-react';
import { itemsApi, settingsApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import type { Item } from '../types';

export function LaundryProcessingPage() {
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
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

  const toggleSection = (sectionKey: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionKey]: !prev[sectionKey]
    }));
  };

  const handleToggleItem = (itemId: string) => {
    setSelectedItems((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId]
    );
  };

  const handleSelectAllForHotel = (hotelItems: Item[]) => {
    const hotelItemIds = hotelItems.map(item => item.id);
    const allSelected = hotelItemIds.every(id => selectedItems.includes(id));

    if (allSelected) {
      setSelectedItems(prev => prev.filter(id => !hotelItemIds.includes(id)));
    } else {
      setSelectedItems(prev => [...new Set([...prev, ...hotelItemIds])]);
    }
  };

  const handleSelectAll = () => {
    if (dirtyItems && selectedItems.length === dirtyItems.length) {
      setSelectedItems([]);
    } else if (dirtyItems) {
      setSelectedItems(dirtyItems.map((item: Item) => item.id));
    }
  };

  const handleMarkClean = () => {
    if (selectedItems.length === 0) {
      toast.warning('Lutfen en az bir urun secin');
      return;
    }
    markCleanMutation.mutate(selectedItems);
  };

  // Group items by hotel, then by type
  const itemsByHotel = (dirtyItems || []).reduce((acc: Record<string, Record<string, Item[]>>, item: Item) => {
    const hotelId = item.tenantId;
    const typeId = item.itemTypeId;

    if (!acc[hotelId]) {
      acc[hotelId] = {};
    }
    if (!acc[hotelId][typeId]) {
      acc[hotelId][typeId] = [];
    }
    acc[hotelId][typeId].push(item);
    return acc;
  }, {});

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      at_hotel: 'bg-blue-100 text-blue-800',
      at_laundry: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-orange-100 text-orange-800',
      ready_for_delivery: 'bg-green-100 text-green-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

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
          {dirtyItems && dirtyItems.length > 0 && (
            <button
              onClick={handleSelectAll}
              className="px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg"
            >
              {selectedItems.length === dirtyItems.length ? 'Tum Secimleri Kaldir' : 'Tumu Sec'}
            </button>
          )}
          <button
            onClick={handleMarkClean}
            disabled={selectedItems.length === 0 || markCleanMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            <CheckCircle className="w-5 h-5" />
            {markCleanMutation.isPending
              ? 'Isleniyor...'
              : `${selectedItems.length} Urunu Temiz Olarak Isaretle`}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-3xl font-bold text-purple-600">{Object.keys(itemsByHotel).length}</p>
          <p className="text-sm text-gray-500">Kirli Urunlu Otel Sayisi</p>
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
          <p className="text-3xl font-bold text-orange-600">
            {dirtyItems?.filter((item: Item) => item.isDamaged || item.isStained).length || 0}
          </p>
          <p className="text-sm text-gray-500">Dikkat Gerektirenler</p>
        </div>
      </div>

      {/* Items Grouped by Hotel */}
      <div className="space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-64 bg-white rounded-lg shadow">
            <RefreshCw className="w-10 h-10 animate-spin text-green-500" />
          </div>
        ) : Object.keys(itemsByHotel).length === 0 ? (
          <div className="p-16 text-center bg-white rounded-lg shadow">
            <Sparkles className="w-20 h-20 mx-auto text-gray-300 mb-4" />
            <p className="text-2xl font-semibold text-gray-500">Islenecek kirli urun yok</p>
            <p className="text-lg text-gray-400 mt-2">Tum urunler temiz!</p>
          </div>
        ) : (
          Object.entries(itemsByHotel).map(([hotelId, itemsByType]) => {
            const hotel = tenants?.find((t) => t.id === hotelId);
            const hotelItems = Object.values(itemsByType).flat();
            const totalItemsForHotel = hotelItems.length;
            const selectedForHotel = hotelItems.filter(item => selectedItems.includes(item.id)).length;
            const hotelSectionKey = `hotel-${hotelId}`;
            const hotelExpanded = expandedSections[hotelSectionKey] !== false; // Default expanded

            return (
              <div key={hotelId} className="bg-white rounded-xl shadow-lg overflow-hidden border-2 border-green-100">
                {/* Hotel Header - Clickable */}
                <button
                  onClick={() => toggleSection(hotelSectionKey)}
                  className="w-full bg-gradient-to-r from-green-600 to-green-500 hover:from-green-700 hover:to-green-600 px-8 py-6 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <span className={`text-white text-2xl transform transition-transform ${hotelExpanded ? 'rotate-90' : ''}`}>
                        &#9654;
                      </span>
                      <h2 className="text-3xl font-bold text-white">
                        {hotel?.name || 'Bilinmeyen Otel'}
                      </h2>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="px-4 py-2 bg-white bg-opacity-25 text-white rounded-full text-lg font-bold">
                        {selectedForHotel}/{totalItemsForHotel} Secili
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectAllForHotel(hotelItems);
                        }}
                        className="px-4 py-2 bg-white text-green-600 rounded-lg font-semibold hover:bg-green-50 transition-colors"
                      >
                        {selectedForHotel === totalItemsForHotel ? 'Tum Secimleri Kaldir' : 'Tumu Sec'}
                      </button>
                    </div>
                  </div>
                </button>

                {/* Item Types - Conditionally Rendered */}
                {hotelExpanded && (
                  <div className="p-6 space-y-4">
                    {Object.entries(itemsByType).map(([typeId, typeItems]) => {
                      const itemType = itemTypes?.find((t) => t.id === typeId);
                      const sectionKey = `${hotelId}-${typeId}`;
                      const expanded = expandedSections[sectionKey] || false;
                      const selectedForType = typeItems.filter(item => selectedItems.includes(item.id)).length;

                      return (
                        <div key={typeId} className="border-2 border-gray-200 rounded-lg overflow-hidden hover:border-green-300 transition-colors">
                          {/* Type Header - Clickable */}
                          <button
                            onClick={() => toggleSection(sectionKey)}
                            className="w-full bg-gray-50 hover:bg-gray-100 px-6 py-5 flex items-center justify-between transition-colors"
                          >
                            <div className="flex items-center gap-4">
                              <Tag className="w-7 h-7 text-green-600" />
                              <div className="text-left">
                                <h3 className="text-2xl font-bold text-gray-900">
                                  {itemType?.name || 'Bilinmeyen Tip'}
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">Urunleri gormek icin tiklayin</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-6">
                              <span className="text-lg text-gray-600">
                                {selectedForType}/{typeItems.length} secili
                              </span>
                              <span className="text-4xl font-bold text-green-600">
                                {typeItems.length}
                              </span>
                              <span className={`transform transition-transform ${expanded ? 'rotate-180' : ''}`}>
                                &#9660;
                              </span>
                            </div>
                          </button>

                          {/* Expanded Details - Items */}
                          {expanded && (
                            <div className="border-t-2 border-gray-200 bg-white">
                              <div className="px-6 py-4 bg-gray-100 border-b flex items-center justify-between">
                                <p className="text-sm font-semibold text-gray-600 uppercase">Urun Detaylari</p>
                                <button
                                  onClick={() => {
                                    const typeItemIds = typeItems.map(item => item.id);
                                    const allSelected = typeItemIds.every(id => selectedItems.includes(id));
                                    if (allSelected) {
                                      setSelectedItems(prev => prev.filter(id => !typeItemIds.includes(id)));
                                    } else {
                                      setSelectedItems(prev => [...new Set([...prev, ...typeItemIds])]);
                                    }
                                  }}
                                  className="text-sm text-green-600 hover:underline"
                                >
                                  {typeItems.every(item => selectedItems.includes(item.id)) ? 'Tip Secimini Kaldir' : 'Tipi Sec'}
                                </button>
                              </div>
                              <div className="divide-y divide-gray-100">
                                {typeItems.map((item) => (
                                  <label
                                    key={item.id}
                                    className="flex items-center gap-4 px-6 py-4 hover:bg-green-50 cursor-pointer transition-colors"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selectedItems.includes(item.id)}
                                      onChange={() => handleToggleItem(item.id)}
                                      className="w-6 h-6 text-green-600 rounded focus:ring-green-500"
                                    />
                                    <div className="flex-1 grid grid-cols-4 gap-4">
                                      <div>
                                        <p className="text-xs text-gray-500 mb-1">RFID Etiketi</p>
                                        <p className="font-mono font-semibold text-gray-900">{item.rfidTag}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-gray-500 mb-1">Durum</p>
                                        <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(item.status)}`}>
                                          {item.status.replace('_', ' ')}
                                        </span>
                                      </div>
                                      <div>
                                        <p className="text-xs text-gray-500 mb-1">Yikama Sayisi</p>
                                        <p className="text-sm font-medium text-gray-900">{item.washCount}x</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-gray-500 mb-1">Isaretler</p>
                                        <div className="flex gap-2">
                                          {item.isDamaged && (
                                            <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs flex items-center gap-1">
                                              <AlertTriangle className="w-3 h-3" />
                                              Hasarli
                                            </span>
                                          )}
                                          {item.isStained && (
                                            <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs">
                                              Lekeli
                                            </span>
                                          )}
                                          {!item.isDamaged && !item.isStained && (
                                            <span className="text-sm text-gray-400">-</span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
