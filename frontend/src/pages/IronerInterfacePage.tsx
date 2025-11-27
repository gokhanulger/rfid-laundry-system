import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Printer, CheckCircle, RefreshCw, Package, Tag, Sparkles, ChevronDown, ChevronRight, Building2, X, Plus, Trash2, Search, Delete } from 'lucide-react';
import { itemsApi, deliveriesApi, settingsApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import { generateDeliveryLabel } from '../lib/pdfGenerator';
import type { Item, Delivery, Tenant } from '../types';

// Storage keys
const SELECTED_HOTELS_KEY = 'laundry_selected_hotels';
const BATCH_THRESHOLDS_KEY = 'laundry_batch_thresholds';
const LAST_PRINTED_TYPE_KEY = 'laundry_last_printed_type';

// Default batch threshold
const DEFAULT_BATCH_SIZE = 10;

// Type for items to print (per hotel)
interface PrintItem {
  typeId: string;
  count: number;
  discardCount: number;
  hasarliCount: number;
}

export function IronerInterfacePage() {
  const [expandedHotels, setExpandedHotels] = useState<Record<string, boolean>>({});
  const [selectedHotelIds, setSelectedHotelIds] = useState<string[]>([]);
  const [isWorking, setIsWorking] = useState(false); // True when user confirmed hotel selection
  const [showHotelSelector, setShowHotelSelector] = useState(false);
  const [batchThresholds, setBatchThresholds] = useState<Record<string, number>>({});
  const [showThresholdSettings, setShowThresholdSettings] = useState(false);
  // For the add item form per hotel
  const [addingTypeId, setAddingTypeId] = useState<Record<string, string>>({});
  const [addingCount, setAddingCount] = useState<Record<string, number>>({});
  // Discard and hasarli state per hotel
  const [addingDiscard, setAddingDiscard] = useState<Record<string, boolean>>({});
  const [addingDiscardCount, setAddingDiscardCount] = useState<Record<string, number>>({});
  const [addingHasarli, setAddingHasarli] = useState<Record<string, boolean>>({});
  const [addingHasarliCount, setAddingHasarliCount] = useState<Record<string, number>>({});
  // Items to print per hotel (list of type+count)
  const [printItems, setPrintItems] = useState<Record<string, PrintItem[]>>({});
  // Last printed item type per hotel for dropdown sorting
  const [lastPrintedType, setLastPrintedType] = useState<Record<string, string>>({});
  // Hotel search filter
  const [hotelSearchFilter, setHotelSearchFilter] = useState('');
  const queryClient = useQueryClient();
  const toast = useToast();

  // Load selected hotels and thresholds from localStorage on mount
  useEffect(() => {
    const savedHotels = localStorage.getItem(SELECTED_HOTELS_KEY);
    if (savedHotels) {
      try {
        const hotels = JSON.parse(savedHotels);
        if (hotels.length > 0) {
          setSelectedHotelIds(hotels);
          setIsWorking(true); // Resume working if hotels were saved
        }
      } catch {
        // Ignore parse errors
      }
    }

    const savedThresholds = localStorage.getItem(BATCH_THRESHOLDS_KEY);
    if (savedThresholds) {
      try {
        setBatchThresholds(JSON.parse(savedThresholds));
      } catch {
        // Ignore parse errors
      }
    }

    const savedLastPrintedType = localStorage.getItem(LAST_PRINTED_TYPE_KEY);
    if (savedLastPrintedType) {
      try {
        setLastPrintedType(JSON.parse(savedLastPrintedType));
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  // Save selected hotels to localStorage
  const saveSelectedHotels = (hotelIds: string[]) => {
    setSelectedHotelIds(hotelIds);
    localStorage.setItem(SELECTED_HOTELS_KEY, JSON.stringify(hotelIds));
  };

  const toggleHotelSelection = (hotelId: string) => {
    const newSelection = selectedHotelIds.includes(hotelId)
      ? selectedHotelIds.filter(id => id !== hotelId)
      : [...selectedHotelIds, hotelId];
    saveSelectedHotels(newSelection);
  };

  const selectAllHotels = () => {
    if (tenants) {
      saveSelectedHotels(tenants.map((t: Tenant) => t.id));
    }
  };

  const clearHotelSelection = () => {
    saveSelectedHotels([]);
  };

  // Threshold management
  const updateThreshold = (itemTypeId: string, value: number) => {
    const newThresholds = {
      ...batchThresholds,
      [itemTypeId]: Math.max(1, value)
    };
    setBatchThresholds(newThresholds);
    localStorage.setItem(BATCH_THRESHOLDS_KEY, JSON.stringify(newThresholds));
  };

  const getThreshold = (itemTypeId: string) => {
    return batchThresholds[itemTypeId] || DEFAULT_BATCH_SIZE;
  };

  // Get dirty items (at_laundry or processing status)
  const { data: dirtyItems, isLoading: loadingDirty, refetch: refetchDirty } = useQuery({
    queryKey: ['dirty-items'],
    queryFn: () => itemsApi.getDirty(),
  });

  // Get tenants for grouping
  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: settingsApi.getTenants,
  });

  // Get item types
  const { data: itemTypes } = useQuery({
    queryKey: ['item-types'],
    queryFn: settingsApi.getItemTypes,
  });

  // Get recently printed deliveries
  const { data: printedDeliveries, refetch: refetchPrinted } = useQuery({
    queryKey: ['deliveries', { status: 'label_printed' }],
    queryFn: () => deliveriesApi.getAll({ status: 'label_printed', limit: 10 }),
  });

  // Type for label extra data
  interface LabelExtraItem {
    typeId: string;
    discardCount: number;
    hasarliCount: number;
  }

  // Mark items clean and create delivery mutation
  const processAndPrintMutation = useMutation({
    mutationFn: async ({ hotelId, itemIds, labelCount, labelExtraData }: { hotelId: string; itemIds: string[]; labelCount: number; labelExtraData?: LabelExtraItem[] }) => {
      // First mark items as ready for delivery
      await itemsApi.markClean(itemIds);

      // Then create a delivery with the specified package count
      const delivery = await deliveriesApi.create({
        tenantId: hotelId,
        itemIds,
        packageCount: labelCount,
      });

      // Get full delivery details for label generation
      const fullDelivery = await deliveriesApi.getById(delivery.id);

      // Generate and print labels with extra data
      generateDeliveryLabel(fullDelivery, labelExtraData);

      // Update status to label_printed
      await deliveriesApi.printLabel(delivery.id);

      return { delivery: fullDelivery, labelCount };
    },
    onSuccess: () => {
      toast.success('Urunler temizlendi ve etiket basildi!');
      queryClient.invalidateQueries({ queryKey: ['dirty-items'] });
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      setPrintItems({});
      refetchDirty();
      refetchPrinted();
    },
    onError: (err) => toast.error('Failed to process items', getErrorMessage(err)),
  });

  const handleRefresh = () => {
    refetchDirty();
    refetchPrinted();
  };

  // Group dirty items by hotel (filter by selected hotels if any are selected)
  const itemsByHotel = (dirtyItems || []).reduce((acc: Record<string, Item[]>, item: Item) => {
    const hotelId = item.tenantId;
    // If no hotels selected, show all. Otherwise filter to selected hotels only.
    if (selectedHotelIds.length > 0 && !selectedHotelIds.includes(hotelId)) {
      return acc;
    }
    if (!acc[hotelId]) {
      acc[hotelId] = [];
    }
    acc[hotelId].push(item);
    return acc;
  }, {});

  // Group items within a hotel by type
  const groupByType = (items: Item[]) => {
    return items.reduce((acc: Record<string, Item[]>, item: Item) => {
      const typeId = item.itemTypeId;
      if (!acc[typeId]) {
        acc[typeId] = [];
      }
      acc[typeId].push(item);
      return acc;
    }, {});
  };

  const toggleHotel = (hotelId: string) => {
    setExpandedHotels(prev => ({
      ...prev,
      [hotelId]: !prev[hotelId]
    }));
  };

  // Add item type + count to the print list for a hotel
  const handleAddToPrintList = (hotelId: string, itemsByType: Record<string, Item[]>) => {
    const typeId = addingTypeId[hotelId];
    const count = addingCount[hotelId] || 1;
    const hasDiscard = addingDiscard[hotelId] || false;
    const discardCount = hasDiscard ? (addingDiscardCount[hotelId] || 0) : 0;
    const hasHasarli = addingHasarli[hotelId] || false;
    const hasarliCount = hasHasarli ? (addingHasarliCount[hotelId] || 0) : 0;

    if (!typeId) {
      toast.warning('Lutfen urun turu secin');
      return;
    }

    const availableItems = itemsByType[typeId] || [];
    if (availableItems.length === 0) {
      toast.warning('Bu tur icin mevcut urun yok');
      return;
    }

    // Check if this type already exists in the list
    const currentList = printItems[hotelId] || [];
    const existingIndex = currentList.findIndex(item => item.typeId === typeId);

    if (existingIndex >= 0) {
      // Update existing entry
      const newCount = Math.min(currentList[existingIndex].count + count, availableItems.length);
      const newList = [...currentList];
      newList[existingIndex] = {
        ...newList[existingIndex],
        count: newCount,
        discardCount: currentList[existingIndex].discardCount + discardCount,
        hasarliCount: currentList[existingIndex].hasarliCount + hasarliCount
      };
      setPrintItems(prev => ({ ...prev, [hotelId]: newList }));
    } else {
      // Add new entry
      const validCount = Math.min(count, availableItems.length);
      setPrintItems(prev => ({
        ...prev,
        [hotelId]: [...(prev[hotelId] || []), { typeId, count: validCount, discardCount, hasarliCount }]
      }));
    }

    // Reset form
    setAddingTypeId(prev => ({ ...prev, [hotelId]: '' }));
    setAddingCount(prev => ({ ...prev, [hotelId]: 1 }));
    setAddingDiscard(prev => ({ ...prev, [hotelId]: false }));
    setAddingDiscardCount(prev => ({ ...prev, [hotelId]: 0 }));
    setAddingHasarli(prev => ({ ...prev, [hotelId]: false }));
    setAddingHasarliCount(prev => ({ ...prev, [hotelId]: 0 }));
  };

  // Remove item from print list
  const handleRemoveFromPrintList = (hotelId: string, index: number) => {
    setPrintItems(prev => ({
      ...prev,
      [hotelId]: (prev[hotelId] || []).filter((_, i) => i !== index)
    }));
  };

  // Clear entire print list for a hotel
  const handleClearPrintList = (hotelId: string) => {
    setPrintItems(prev => ({ ...prev, [hotelId]: [] }));
  };

  const handleCleanAndPrint = (hotelId: string, itemsByType: Record<string, Item[]>) => {
    const currentPrintItems = printItems[hotelId] || [];

    if (currentPrintItems.length === 0) {
      toast.warning('En az bir urun turu ekleyin');
      return;
    }

    // Collect all item IDs from the print list
    const itemIds: string[] = [];
    for (const printItem of currentPrintItems) {
      const availableItems = itemsByType[printItem.typeId] || [];
      const itemsToAdd = availableItems.slice(0, printItem.count);
      itemIds.push(...itemsToAdd.map(i => i.id));
    }

    if (itemIds.length === 0) {
      toast.warning('Yazdirilacak urun yok');
      return;
    }

    // Save last printed type for this hotel (use the first item type)
    if (currentPrintItems.length > 0) {
      const newLastPrintedType = { ...lastPrintedType, [hotelId]: currentPrintItems[0].typeId };
      setLastPrintedType(newLastPrintedType);
      localStorage.setItem(LAST_PRINTED_TYPE_KEY, JSON.stringify(newLastPrintedType));
    }

    // Pass extra data for label (discard/hasarli counts)
    const labelExtraData = currentPrintItems.map(item => ({
      typeId: item.typeId,
      discardCount: item.discardCount,
      hasarliCount: item.hasarliCount
    }));

    processAndPrintMutation.mutate({ hotelId, itemIds, labelCount: 1, labelExtraData });
  };

  // Calculate total items in print list
  const getTotalPrintItems = (hotelId: string) => {
    return (printItems[hotelId] || []).reduce((sum, item) => sum + item.count, 0);
  };

  const recentPrinted = printedDeliveries?.data || [];
  const hotelCount = Object.keys(itemsByHotel).length;

  // Count filtered vs total items
  const filteredItemCount = Object.values(itemsByHotel).flat().length;

  // Hotel Selection Dialog
  // Filter tenants by search
  const filteredTenants = tenants?.filter((tenant: Tenant) =>
    hotelSearchFilter === '' || tenant.name.toLowerCase().includes(hotelSearchFilter.toLowerCase())
  ) || [];

  // On-screen keyboard handler
  const handleKeyboardPress = (key: string) => {
    if (key === 'backspace') {
      setHotelSearchFilter(prev => prev.slice(0, -1));
    } else if (key === 'clear') {
      setHotelSearchFilter('');
    } else if (key === 'space') {
      setHotelSearchFilter(prev => prev + ' ');
    } else {
      setHotelSearchFilter(prev => prev + key);
    }
  };

  const HotelSelectionDialog = () => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-4xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Building2 className="w-6 h-6 text-blue-600" />
            Otel Sec
          </h2>
          {isWorking && (
            <button
              onClick={() => {
                setShowHotelSelector(false);
                setHotelSearchFilter('');
              }}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Search Input */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={hotelSearchFilter}
              onChange={(e) => setHotelSearchFilter(e.target.value)}
              placeholder="Otel ara..."
              className="w-full pl-10 pr-4 py-3 border-2 border-gray-300 rounded-lg text-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {hotelSearchFilter && (
              <button
                onClick={() => setHotelSearchFilter('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Main content: Hotel list on left, Keyboard on right */}
        <div className="flex gap-4 mb-4">
          {/* Left side: Hotel list */}
          <div className="flex-1">
            {/* Scrollable hotel list */}
            <div className="max-h-[350px] overflow-y-auto border rounded-lg divide-y">
              {filteredTenants.length === 0 ? (
                <div className="p-4 text-center text-gray-500">
                  Otel bulunamadi
                </div>
              ) : (
                filteredTenants.map((tenant: Tenant) => {
                  const isSelected = selectedHotelIds.includes(tenant.id);
                  const hotelDirtyCount = (dirtyItems || []).filter((i: Item) => i.tenantId === tenant.id).length;
                  return (
                    <label
                      key={tenant.id}
                      className={`flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                        isSelected ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleHotelSelection(tenant.id)}
                          className="w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                        />
                        <span className={`font-medium ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>
                          {tenant.name}
                        </span>
                      </div>
                      {hotelDirtyCount > 0 ? (
                        <span className={`px-2 py-1 rounded-full text-sm font-bold ${
                          hotelDirtyCount > 10 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                        }`}>
                          {hotelDirtyCount}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">0</span>
                      )}
                    </label>
                  );
                })
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={selectAllHotels}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  Tumunu Sec
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={clearHotelSelection}
                  className="text-sm text-gray-600 hover:text-gray-700 font-medium"
                >
                  Temizle
                </button>
              </div>
              <span className="text-sm text-gray-600">
                {selectedHotelIds.length} secildi
              </span>
            </div>
          </div>

          {/* Right side: On-screen Keyboard */}
          <div className="w-80 bg-gray-50 rounded-lg p-3 border border-gray-200">
            <p className="text-sm font-medium text-gray-600 mb-2 text-center">Klavye</p>
            <div className="grid grid-cols-10 gap-1 mb-1">
              {['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'].map((key) => (
                <button
                  key={key}
                  onClick={() => handleKeyboardPress(key)}
                  className="h-9 bg-white border border-gray-300 rounded font-bold text-sm text-gray-700 hover:bg-gray-100 active:bg-gray-200 transition-colors"
                >
                  {key}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-10 gap-1 mb-1">
              <div className="col-span-1" />
              {['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'].map((key) => (
                <button
                  key={key}
                  onClick={() => handleKeyboardPress(key)}
                  className="h-9 bg-white border border-gray-300 rounded font-bold text-sm text-gray-700 hover:bg-gray-100 active:bg-gray-200 transition-colors"
                >
                  {key}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-10 gap-1 mb-1">
              <div className="col-span-1" />
              {['Z', 'X', 'C', 'V', 'B', 'N', 'M'].map((key) => (
                <button
                  key={key}
                  onClick={() => handleKeyboardPress(key)}
                  className="h-9 bg-white border border-gray-300 rounded font-bold text-sm text-gray-700 hover:bg-gray-100 active:bg-gray-200 transition-colors"
                >
                  {key}
                </button>
              ))}
              <button
                onClick={() => handleKeyboardPress('backspace')}
                className="h-9 col-span-2 bg-red-100 border border-red-300 rounded font-bold text-red-700 hover:bg-red-200 active:bg-red-300 transition-colors flex items-center justify-center"
              >
                <Delete className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-10 gap-1 mb-2">
              <button
                onClick={() => handleKeyboardPress('clear')}
                className="h-9 col-span-3 bg-gray-200 border border-gray-400 rounded font-bold text-xs text-gray-700 hover:bg-gray-300 active:bg-gray-400 transition-colors"
              >
                Temizle
              </button>
              <button
                onClick={() => handleKeyboardPress('space')}
                className="h-9 col-span-4 bg-white border border-gray-300 rounded font-bold text-xs text-gray-500 hover:bg-gray-100 active:bg-gray-200 transition-colors"
              >
                Bosluk
              </button>
              <button
                onClick={() => handleKeyboardPress('Ü')}
                className="h-9 bg-white border border-gray-300 rounded font-bold text-sm text-gray-700 hover:bg-gray-100 active:bg-gray-200 transition-colors"
              >
                Ü
              </button>
              <button
                onClick={() => handleKeyboardPress('Ş')}
                className="h-9 bg-white border border-gray-300 rounded font-bold text-sm text-gray-700 hover:bg-gray-100 active:bg-gray-200 transition-colors"
              >
                Ş
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1">
              <button
                onClick={() => handleKeyboardPress('İ')}
                className="h-9 bg-white border border-gray-300 rounded font-bold text-sm text-gray-700 hover:bg-gray-100 active:bg-gray-200 transition-colors"
              >
                İ
              </button>
              <button
                onClick={() => handleKeyboardPress('Ö')}
                className="h-9 bg-white border border-gray-300 rounded font-bold text-sm text-gray-700 hover:bg-gray-100 active:bg-gray-200 transition-colors"
              >
                Ö
              </button>
              <button
                onClick={() => handleKeyboardPress('Ç')}
                className="h-9 bg-white border border-gray-300 rounded font-bold text-sm text-gray-700 hover:bg-gray-100 active:bg-gray-200 transition-colors"
              >
                Ç
              </button>
              <button
                onClick={() => handleKeyboardPress('Ğ')}
                className="h-9 bg-white border border-gray-300 rounded font-bold text-sm text-gray-700 hover:bg-gray-100 active:bg-gray-200 transition-colors"
              >
                Ğ
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={() => {
            if (selectedHotelIds.length > 0) {
              saveSelectedHotels(selectedHotelIds);
              setIsWorking(true);
              setShowHotelSelector(false);
              setHotelSearchFilter('');
            }
          }}
          disabled={selectedHotelIds.length === 0}
          className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold shadow-lg disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {isWorking ? 'Secimi Guncelle' : 'Calismaya Basla'}
        </button>
      </div>
    </div>
  );

  // Show dialog on initial load
  if (!isWorking) {
    return (
      <>
        <div className="p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-100 rounded-lg">
              <Printer className="w-8 h-8 text-purple-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Ütü İstasyonu</h1>
              <p className="text-gray-500">Isleme baslamak icin otel secin</p>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <Building2 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-xl text-gray-500 mb-2">Otel secilmedi</p>
            <p className="text-gray-400">Baslamak icin otelleri secin</p>
          </div>
        </div>
        <HotelSelectionDialog />
      </>
    );
  }

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      {/* Header with selected hotels */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-purple-100 rounded-lg">
            <Printer className="w-8 h-8 text-purple-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Ütü İstasyonu</h1>
            <p className="text-gray-500">
              Calisilan {selectedHotelIds.length} otel
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowThresholdSettings(!showThresholdSettings)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
              showThresholdSettings
                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Tag className="w-4 h-4" />
            Ayarlar
          </button>
          <button
            onClick={() => setShowHotelSelector(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"
          >
            <Building2 className="w-4 h-4" />
            Otel Degistir
          </button>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <RefreshCw className="w-4 h-4" />
            Yenile
          </button>
        </div>
      </div>

      {/* Selected Hotels Bar */}
      <div className="bg-blue-50 rounded-lg p-4 flex items-center gap-3 flex-wrap">
        <span className="text-blue-700 font-medium">Calisilan:</span>
        {selectedHotelIds.map(hotelId => {
          const hotel = tenants?.find((t: Tenant) => t.id === hotelId);
          const hotelDirtyCount = (dirtyItems || []).filter((i: Item) => i.tenantId === hotelId).length;
          return (
            <div
              key={hotelId}
              className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-full border border-blue-200"
            >
              <Building2 className="w-4 h-4 text-blue-600" />
              <span className="font-medium text-gray-900">{hotel?.name}</span>
              {hotelDirtyCount > 0 && (
                <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs font-bold">
                  {hotelDirtyCount}
                </span>
              )}
              <button
                onClick={() => toggleHotelSelection(hotelId)}
                className="text-gray-400 hover:text-red-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
        <button
          onClick={() => setShowHotelSelector(true)}
          className="flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Otel Ekle
        </button>
      </div>

      {/* Hotel Selection Dialog */}
      {showHotelSelector && <HotelSelectionDialog />}

      {/* Threshold Settings Panel */}
      {showThresholdSettings && (
        <div className="bg-white rounded-xl shadow-lg border-2 border-green-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Tag className="w-5 h-5 text-green-600" />
              Grup Esik Ayarlari
            </h3>
            <button
              onClick={() => setShowThresholdSettings(false)}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Bir grubun yazdirma icin hazir olmasi gereken minimum urun sayisini ayarlayin
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {itemTypes?.map((itemType: any) => (
              <div key={itemType.id} className="bg-gray-50 rounded-lg p-4">
                <p className="font-medium text-gray-900 mb-2">{itemType.name}</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateThreshold(itemType.id, getThreshold(itemType.id) - 1)}
                    className="w-8 h-8 bg-white border border-gray-300 rounded text-lg font-bold hover:bg-gray-100"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="1"
                    value={getThreshold(itemType.id)}
                    onChange={(e) => updateThreshold(itemType.id, parseInt(e.target.value) || 1)}
                    className="w-16 h-8 text-center border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                  />
                  <button
                    onClick={() => updateThreshold(itemType.id, getThreshold(itemType.id) + 1)}
                    className="w-8 h-8 bg-white border border-gray-300 rounded text-lg font-bold hover:bg-gray-100"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t flex justify-end">
            <button
              onClick={() => setShowThresholdSettings(false)}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Tamam
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-3xl font-bold text-purple-600">{hotelCount}</p>
          <p className="text-sm text-gray-500">Urunlu Oteller</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-3xl font-bold text-orange-600">{filteredItemCount}</p>
          <p className="text-sm text-gray-500">Kirli Urunler</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-3xl font-bold text-green-600">{recentPrinted.length}</p>
          <p className="text-sm text-gray-500">Basilan Etiketler</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Section: Hotel Cards with Dirty Items */}
        <div className="lg:col-span-2 space-y-6">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-orange-500" />
            Islenecek Kirli Urunler
          </h2>

          {loadingDirty ? (
            <div className="flex items-center justify-center h-64 bg-white rounded-lg shadow">
              <RefreshCw className="w-10 h-10 animate-spin text-purple-500" />
            </div>
          ) : hotelCount === 0 ? (
            <div className="p-16 text-center bg-white rounded-lg shadow">
              <Package className="w-20 h-20 mx-auto text-gray-300 mb-4" />
              <p className="text-2xl font-semibold text-gray-500">Islenecek kirli urun yok</p>
              <p className="text-lg text-gray-400 mt-2">Secili otellerdeki tum urunler temizlendi!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(itemsByHotel).map(([hotelId, hotelItems]) => {
                const hotel = tenants?.find((t: Tenant) => t.id === hotelId);
                const isExpanded = expandedHotels[hotelId] || false;
                const itemsByType = groupByType(hotelItems);

                return (
                  <div key={hotelId} className="bg-white rounded-xl shadow-lg overflow-hidden border-2 border-orange-200">
                    {/* Hotel Header - Big Card */}
                    <button
                      onClick={() => toggleHotel(hotelId)}
                      className="w-full bg-gradient-to-r from-orange-500 to-orange-400 hover:from-orange-600 hover:to-orange-500 px-6 py-5 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          {isExpanded ? (
                            <ChevronDown className="w-8 h-8 text-white" />
                          ) : (
                            <ChevronRight className="w-8 h-8 text-white" />
                          )}
                          <div className="text-left">
                            <h3 className="text-2xl font-bold text-white">
                              {hotel?.name || 'Bilinmeyen Otel'}
                            </h3>
                            <p className="text-orange-100 text-sm mt-1">
                              Urunleri gormek ve islemek icin tiklayin
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-4xl font-bold text-white">{hotelItems.length}</p>
                            <p className="text-orange-100 text-sm">kirli urun</p>
                          </div>
                        </div>
                      </div>
                    </button>

                    {/* Expanded Content - Add Multiple Items Interface */}
                    {isExpanded && (
                      <div className="p-6">
                        <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl p-6 border-2 border-purple-200">
                          <h4 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                            <Printer className="w-5 h-5 text-purple-600" />
                            Etiket Yazdir
                          </h4>

                          {/* Add Item Form */}
                          <div className="space-y-4 mb-4">
                            <div className="flex gap-4">
                              {/* Left side: Dropdown, Count, Add Button */}
                              <div className="flex-1 space-y-3">
                                {/* Item Type Dropdown - sorted with last printed at top */}
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Urun Turu
                                  </label>
                                  <select
                                    value={addingTypeId[hotelId] || ''}
                                    onChange={(e) => setAddingTypeId(prev => ({ ...prev, [hotelId]: e.target.value }))}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg text-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                  >
                                    <option value="">Tur secin...</option>
                                    {/* Sort entries: last printed type first */}
                                    {Object.entries(itemsByType)
                                      .sort(([aTypeId], [bTypeId]) => {
                                        const lastType = lastPrintedType[hotelId];
                                        if (lastType === aTypeId) return -1;
                                        if (lastType === bTypeId) return 1;
                                        return 0;
                                      })
                                      .map(([typeId, typeItems]) => {
                                        const itemType = itemTypes?.find((t: { id: string }) => t.id === typeId);
                                        const isLastPrinted = lastPrintedType[hotelId] === typeId;
                                        return (
                                          <option key={typeId} value={typeId}>
                                            {isLastPrinted ? '★ ' : ''}{itemType?.name} ({typeItems.length} mevcut)
                                          </option>
                                        );
                                      })}
                                  </select>
                                </div>

                                {/* Count Input and Add Button */}
                                <div className="flex items-end gap-3 justify-end">
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                      Adet
                                    </label>
                                    <div className="flex items-center">
                                      <button
                                        onClick={() => setAddingCount(prev => ({ ...prev, [hotelId]: Math.max(1, (prev[hotelId] || 1) - 1) }))}
                                        className="w-10 h-12 bg-gray-100 border-2 border-r-0 border-gray-300 rounded-l-lg text-xl font-bold hover:bg-gray-200 transition-colors"
                                      >
                                        -
                                      </button>
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        value={addingCount[hotelId] === undefined ? '' : addingCount[hotelId]}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          if (val === '') {
                                            setAddingCount(prev => ({ ...prev, [hotelId]: undefined as any }));
                                          } else {
                                            const num = parseInt(val);
                                            if (!isNaN(num) && num >= 0) {
                                              setAddingCount(prev => ({ ...prev, [hotelId]: num }));
                                            }
                                          }
                                        }}
                                        onBlur={(e) => {
                                          const val = parseInt(e.target.value);
                                          if (isNaN(val) || val < 1) {
                                            setAddingCount(prev => ({ ...prev, [hotelId]: 1 }));
                                          }
                                        }}
                                        placeholder="1"
                                        className="w-16 h-12 text-center text-xl font-bold border-2 border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 focus:z-10"
                                      />
                                      <button
                                        onClick={() => setAddingCount(prev => ({ ...prev, [hotelId]: ((prev[hotelId] || 0) + 1) }))}
                                        className="w-10 h-12 bg-gray-100 border-2 border-l-0 border-gray-300 rounded-r-lg text-xl font-bold hover:bg-gray-200 transition-colors"
                                      >
                                        +
                                      </button>
                                    </div>
                                  </div>

                                  {/* Add Button */}
                                  <button
                                    onClick={() => handleAddToPrintList(hotelId, itemsByType)}
                                    disabled={!addingTypeId[hotelId]}
                                    className="h-12 px-6 flex items-center gap-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-bold transition-all"
                                  >
                                    <Plus className="w-5 h-5" />
                                    Ekle
                                  </button>
                                </div>
                              </div>

                              {/* Right side: Number Pad */}
                              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 w-36 self-end">
                                <p className="text-xs font-medium text-gray-600 mb-2 text-center">Numara</p>
                                <div className="grid grid-cols-3 gap-1">
                                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                                    <button
                                      key={num}
                                      onClick={() => setAddingCount(prev => ({ ...prev, [hotelId]: (prev[hotelId] || 0) * 10 + num }))}
                                      className="h-8 rounded font-bold text-base bg-white border border-gray-300 text-gray-700 hover:bg-purple-50 hover:border-purple-400 active:bg-purple-100 transition-all"
                                    >
                                      {num}
                                    </button>
                                  ))}
                                  <button
                                    onClick={() => setAddingCount(prev => ({ ...prev, [hotelId]: 0 }))}
                                    className="h-8 rounded font-bold text-xs bg-red-100 text-red-700 border border-red-300 hover:bg-red-200 active:bg-red-300 transition-all"
                                  >
                                    C
                                  </button>
                                  <button
                                    onClick={() => setAddingCount(prev => ({ ...prev, [hotelId]: (prev[hotelId] || 0) * 10 }))}
                                    className="h-8 rounded font-bold text-base bg-white border border-gray-300 text-gray-700 hover:bg-purple-50 hover:border-purple-400 active:bg-purple-100 transition-all"
                                  >
                                    0
                                  </button>
                                  <button
                                    onClick={() => setAddingCount(prev => ({ ...prev, [hotelId]: Math.floor((prev[hotelId] || 0) / 10) }))}
                                    className="h-8 rounded font-bold text-sm bg-gray-200 border border-gray-400 text-gray-700 hover:bg-gray-300 active:bg-gray-400 transition-all flex items-center justify-center"
                                  >
                                    <Delete className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* Discard and Hasarli Checkboxes */}
                            <div className="flex flex-wrap gap-4 bg-gray-50 rounded-lg p-4 border border-gray-200">
                              {/* Discard */}
                              <div className="flex flex-col gap-2">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={addingDiscard[hotelId] || false}
                                    onChange={(e) => {
                                      setAddingDiscard(prev => ({ ...prev, [hotelId]: e.target.checked }));
                                      if (!e.target.checked) {
                                        setAddingDiscardCount(prev => ({ ...prev, [hotelId]: 0 }));
                                      } else if (!addingDiscardCount[hotelId]) {
                                        setAddingDiscardCount(prev => ({ ...prev, [hotelId]: 1 }));
                                      }
                                    }}
                                    className="w-5 h-5 text-red-600 rounded border-gray-300 focus:ring-red-500"
                                  />
                                  <span className="font-medium text-gray-700">Discord</span>
                                </label>
                                {addingDiscard[hotelId] && (
                                  <div className="flex gap-2">
                                    <div className="flex items-center gap-1">
                                      <button
                                        onClick={() => setAddingDiscardCount(prev => ({ ...prev, [hotelId]: Math.max(0, (prev[hotelId] || 1) - 1) }))}
                                        className="w-8 h-8 bg-white border border-gray-300 rounded text-lg font-bold hover:bg-gray-100"
                                      >
                                        -
                                      </button>
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        value={addingDiscardCount[hotelId] || 0}
                                        onChange={(e) => {
                                          const num = parseInt(e.target.value);
                                          if (!isNaN(num) && num >= 0) {
                                            setAddingDiscardCount(prev => ({ ...prev, [hotelId]: num }));
                                          }
                                        }}
                                        className="w-14 h-8 text-center border border-gray-300 rounded focus:ring-2 focus:ring-red-500"
                                      />
                                      <button
                                        onClick={() => setAddingDiscardCount(prev => ({ ...prev, [hotelId]: (prev[hotelId] || 0) + 1 }))}
                                        className="w-8 h-8 bg-white border border-gray-300 rounded text-lg font-bold hover:bg-gray-100"
                                      >
                                        +
                                      </button>
                                    </div>
                                    {/* Discord Number Pad */}
                                    <div className="bg-white rounded p-1 border border-gray-200">
                                      <div className="grid grid-cols-4 gap-0.5">
                                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((num) => (
                                          <button
                                            key={num}
                                            onClick={() => setAddingDiscardCount(prev => ({ ...prev, [hotelId]: (prev[hotelId] || 0) * 10 + num }))}
                                            className="w-6 h-6 rounded text-xs font-bold bg-gray-50 border border-gray-200 text-gray-700 hover:bg-red-50 hover:border-red-300 active:bg-red-100 transition-all"
                                          >
                                            {num}
                                          </button>
                                        ))}
                                        <button
                                          onClick={() => setAddingDiscardCount(prev => ({ ...prev, [hotelId]: 0 }))}
                                          className="w-6 h-6 rounded text-xs font-bold bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 transition-all"
                                        >
                                          C
                                        </button>
                                        <button
                                          onClick={() => setAddingDiscardCount(prev => ({ ...prev, [hotelId]: Math.floor((prev[hotelId] || 0) / 10) }))}
                                          className="w-6 h-6 rounded text-xs font-bold bg-gray-100 border border-gray-300 text-gray-600 hover:bg-gray-200 transition-all"
                                        >
                                          ←
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Hasarli (Damaged) */}
                              <div className="flex flex-col gap-2">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={addingHasarli[hotelId] || false}
                                    onChange={(e) => {
                                      setAddingHasarli(prev => ({ ...prev, [hotelId]: e.target.checked }));
                                      if (!e.target.checked) {
                                        setAddingHasarliCount(prev => ({ ...prev, [hotelId]: 0 }));
                                      } else if (!addingHasarliCount[hotelId]) {
                                        setAddingHasarliCount(prev => ({ ...prev, [hotelId]: 1 }));
                                      }
                                    }}
                                    className="w-5 h-5 text-orange-600 rounded border-gray-300 focus:ring-orange-500"
                                  />
                                  <span className="font-medium text-gray-700">Lekeli Urun</span>
                                </label>
                                {addingHasarli[hotelId] && (
                                  <div className="flex gap-2">
                                    <div className="flex items-center gap-1">
                                      <button
                                        onClick={() => setAddingHasarliCount(prev => ({ ...prev, [hotelId]: Math.max(0, (prev[hotelId] || 1) - 1) }))}
                                        className="w-8 h-8 bg-white border border-gray-300 rounded text-lg font-bold hover:bg-gray-100"
                                      >
                                        -
                                      </button>
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        value={addingHasarliCount[hotelId] || 0}
                                        onChange={(e) => {
                                          const num = parseInt(e.target.value);
                                          if (!isNaN(num) && num >= 0) {
                                            setAddingHasarliCount(prev => ({ ...prev, [hotelId]: num }));
                                          }
                                        }}
                                        className="w-14 h-8 text-center border border-gray-300 rounded focus:ring-2 focus:ring-orange-500"
                                      />
                                      <button
                                        onClick={() => setAddingHasarliCount(prev => ({ ...prev, [hotelId]: (prev[hotelId] || 0) + 1 }))}
                                        className="w-8 h-8 bg-white border border-gray-300 rounded text-lg font-bold hover:bg-gray-100"
                                      >
                                        +
                                      </button>
                                    </div>
                                    {/* Lekeli Number Pad */}
                                    <div className="bg-white rounded p-1 border border-gray-200">
                                      <div className="grid grid-cols-4 gap-0.5">
                                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((num) => (
                                          <button
                                            key={num}
                                            onClick={() => setAddingHasarliCount(prev => ({ ...prev, [hotelId]: (prev[hotelId] || 0) * 10 + num }))}
                                            className="w-6 h-6 rounded text-xs font-bold bg-gray-50 border border-gray-200 text-gray-700 hover:bg-orange-50 hover:border-orange-300 active:bg-orange-100 transition-all"
                                          >
                                            {num}
                                          </button>
                                        ))}
                                        <button
                                          onClick={() => setAddingHasarliCount(prev => ({ ...prev, [hotelId]: 0 }))}
                                          className="w-6 h-6 rounded text-xs font-bold bg-orange-50 border border-orange-200 text-orange-600 hover:bg-orange-100 transition-all"
                                        >
                                          C
                                        </button>
                                        <button
                                          onClick={() => setAddingHasarliCount(prev => ({ ...prev, [hotelId]: Math.floor((prev[hotelId] || 0) / 10) }))}
                                          className="w-6 h-6 rounded text-xs font-bold bg-gray-100 border border-gray-300 text-gray-600 hover:bg-gray-200 transition-all"
                                        >
                                          ←
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Items List */}
                          {(printItems[hotelId] || []).length > 0 && (
                            <div className="mb-4 bg-white rounded-lg border-2 border-gray-200 divide-y">
                              {(printItems[hotelId] || []).map((item, index) => {
                                const itemType = itemTypes?.find((t: { id: string }) => t.id === item.typeId);
                                return (
                                  <div key={index} className="flex items-center justify-between px-4 py-3">
                                    <div className="flex items-center gap-3 flex-wrap">
                                      <span className="text-2xl font-bold text-purple-600">{item.count}x</span>
                                      <span className="text-lg font-medium text-gray-800">{itemType?.name}</span>
                                      {item.discardCount > 0 && (
                                        <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-sm font-medium">
                                          Discord: {item.discardCount}
                                        </span>
                                      )}
                                      {item.hasarliCount > 0 && (
                                        <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded-full text-sm font-medium">
                                          Lekeli: {item.hasarliCount}
                                        </span>
                                      )}
                                    </div>
                                    <button
                                      onClick={() => handleRemoveFromPrintList(hotelId, index)}
                                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                    >
                                      <Trash2 className="w-5 h-5" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Print Button */}
                          {(printItems[hotelId] || []).length > 0 && (
                            <div className="flex items-center justify-between pt-4 border-t border-purple-200">
                              <div className="flex items-center gap-4">
                                <span className="text-gray-600">
                                  Toplam: <span className="font-bold text-purple-600">{getTotalPrintItems(hotelId)}</span> urun
                                </span>
                                <button
                                  onClick={() => handleClearPrintList(hotelId)}
                                  className="text-sm text-gray-500 hover:text-gray-700 underline"
                                >
                                  Temizle
                                </button>
                              </div>
                              <button
                                onClick={() => handleCleanAndPrint(hotelId, itemsByType)}
                                disabled={processAndPrintMutation.isPending}
                                className="h-12 px-8 flex items-center gap-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-lg font-bold shadow-lg transition-all"
                              >
                                <Printer className="w-5 h-5" />
                                {processAndPrintMutation.isPending ? 'Yazdiriliyor...' : 'Etiket Yazdir'}
                              </button>
                            </div>
                          )}

                          {/* Empty State */}
                          {(printItems[hotelId] || []).length === 0 && (
                            <div className="text-center py-6 text-gray-500">
                              <Package className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                              <p>Urun turu ve adet secin, sonra Ekle'ye tiklayin</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Sidebar: Recently Printed */}
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow sticky top-4">
            <div className="p-4 border-b bg-green-50">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                Son Yazdirilan Etiketler
              </h2>
            </div>
            {recentPrinted.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <Printer className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                <p>Son yazdirilan etiket yok</p>
              </div>
            ) : (
              <div className="divide-y max-h-[600px] overflow-y-auto">
                {recentPrinted.map((delivery: Delivery) => (
                  <div key={delivery.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono font-bold text-lg">{delivery.barcode}</span>
                      <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                        Yazdirildi
                      </span>
                    </div>
                    <p className="text-sm font-medium text-gray-900">{delivery.tenant?.name}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span>{delivery.deliveryItems?.length || 0} urun</span>
                      <span>{delivery.packageCount || 1} paket</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {delivery.labelPrintedAt && new Date(delivery.labelPrintedAt).toLocaleString('tr-TR')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
