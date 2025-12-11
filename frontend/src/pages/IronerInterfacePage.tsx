import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Printer, RefreshCw, Package, Tag, Sparkles, Building2, X, Plus, Search, Delete } from 'lucide-react';
import { itemsApi, deliveriesApi, settingsApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import { generateDeliveryLabel } from '../lib/pdfGenerator';
import type { Item, Tenant } from '../types';

// Storage keys
const SELECTED_HOTELS_KEY = 'laundry_selected_hotels';
const BATCH_THRESHOLDS_KEY = 'laundry_batch_thresholds';
const LAST_PRINTED_TYPE_KEY = 'laundry_last_printed_type';

// Default batch threshold
const DEFAULT_BATCH_SIZE = 10;

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
  // Last printed item type per hotel for dropdown sorting
  const [lastPrintedType, setLastPrintedType] = useState<Record<string, string>>({});
  // Hotel search filter
  const [hotelSearchFilter, setHotelSearchFilter] = useState('');
  // Active hotel for the right panel form
  const [activeHotelId, setActiveHotelId] = useState<string | null>(null);
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
    if (Array.isArray(tenants)) {
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

  // Ensure tenants is always an array
  const tenantsArray = Array.isArray(tenants) ? tenants : [];

  // Get item types
  const { data: itemTypes } = useQuery({
    queryKey: ['item-types'],
    queryFn: settingsApi.getItemTypes,
  });

  // Get recently printed deliveries (used for refetch after printing)
  const { refetch: refetchPrinted } = useQuery({
    queryKey: ['deliveries', { status: 'label_printed' }],
    queryFn: () => deliveriesApi.getAll({ status: 'label_printed', limit: 10 }),
  });

  // Type for label extra data
  interface LabelExtraItem {
    typeId: string;
    typeName?: string;
    count?: number;
    discardCount: number;
    hasarliCount: number;
  }

  // Mark items clean and create delivery mutation
  const processAndPrintMutation = useMutation({
    mutationFn: async ({ hotelId, itemIds, labelCount, labelExtraData }: { hotelId: string; itemIds: string[]; labelCount: number; labelExtraData?: LabelExtraItem[] }) => {
      console.log('mutation - labelExtraData received:', JSON.stringify(labelExtraData));
      console.log('mutation - itemIds:', JSON.stringify(itemIds));

      // First mark items as ready for delivery (skip if no items)
      if (itemIds.length > 0) {
        await itemsApi.markClean(itemIds);
      }

      // Then create a delivery with the specified package count
      // Store labelExtraData in notes as JSON for later retrieval
      const delivery = await deliveriesApi.create({
        tenantId: hotelId,
        itemIds,
        packageCount: labelCount,
        notes: labelExtraData ? JSON.stringify(labelExtraData) : undefined,
      });
      console.log('mutation - delivery created, id:', delivery.id, 'status:', delivery.status, 'notes:', delivery.notes);

      // Get full delivery details for label generation
      const fullDelivery = await deliveriesApi.getById(delivery.id);
      console.log('mutation - fullDelivery status:', fullDelivery.status);

      // Generate and print labels with extra data
      generateDeliveryLabel(fullDelivery, labelExtraData);

      // Update status to label_printed
      try {
        const printedDelivery = await deliveriesApi.printLabel(delivery.id);
        console.log('mutation - printLabel success, new status:', printedDelivery.status);
      } catch (printError) {
        console.error('mutation - printLabel failed:', printError);
        // Continue anyway - label was generated
      }

      return { delivery: fullDelivery, labelCount };
    },
    onSuccess: () => {
      toast.success('Urunler temizlendi ve etiket basildi!');
      queryClient.invalidateQueries({ queryKey: ['dirty-items'] });
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
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
  // Ensure dirtyItems is an array
  const dirtyItemsArray = Array.isArray(dirtyItems) ? dirtyItems : [];
  const itemsByHotel = dirtyItemsArray.reduce((acc: Record<string, Item[]>, item: Item) => {
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


  // Hotel Selection Dialog
  // Filter tenants by search
  const filteredTenants = tenantsArray.filter((tenant: Tenant) =>
    hotelSearchFilter === '' || tenant.name.toLowerCase().includes(hotelSearchFilter.toLowerCase())
  );

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

      {/* Selected Hotels Bar - Sticky at top */}
      <div className="bg-blue-50 rounded-lg p-4 flex items-center gap-3 flex-wrap sticky top-0 z-40 shadow-sm">
        <span className="text-blue-700 font-medium">Calisilan:</span>
        {selectedHotelIds.map(hotelId => {
          const hotel = tenantsArray.find((t: Tenant) => t.id === hotelId);
          return (
            <div
              key={hotelId}
              className={`flex items-center gap-1 pl-3 pr-1 py-1 rounded-full border transition-all ${
                expandedHotels[hotelId]
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-blue-200 hover:bg-blue-100'
              }`}
            >
              <button
                onClick={() => {
                  // Expand/collapse the hotel's work section
                  setExpandedHotels(prev => ({
                    ...prev,
                    [hotelId]: !prev[hotelId]
                  }));
                  // Scroll to the hotel section
                  const hotelElement = document.getElementById(`hotel-section-${hotelId}`);
                  if (hotelElement) {
                    hotelElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                }}
                className="flex items-center gap-2"
              >
                <Building2 className={`w-4 h-4 ${expandedHotels[hotelId] ? 'text-white' : 'text-blue-600'}`} />
                <span className={`font-medium ${expandedHotels[hotelId] ? 'text-white' : 'text-gray-900'}`}>{hotel?.name}</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // Remove hotel from selection
                  const newSelection = selectedHotelIds.filter(id => id !== hotelId);
                  saveSelectedHotels(newSelection);
                  // Collapse if expanded
                  setExpandedHotels(prev => ({ ...prev, [hotelId]: false }));
                }}
                className={`ml-1 p-1 rounded-full transition-colors ${
                  expandedHotels[hotelId]
                    ? 'hover:bg-blue-500 text-white'
                    : 'hover:bg-red-100 text-gray-400 hover:text-red-600'
                }`}
                title="Oteli kaldir"
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

      {/* Main Content: Two Column Layout */}
      <div className="flex gap-6">
        {/* Left Column: Hotel Cards */}
        <div className="w-80 flex-shrink-0 space-y-3">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-4">
            <Building2 className="w-5 h-5 text-orange-500" />
            Oteller
          </h2>

          {loadingDirty ? (
            <div className="flex items-center justify-center h-32 bg-white rounded-lg shadow">
              <RefreshCw className="w-8 h-8 animate-spin text-purple-500" />
            </div>
          ) : selectedHotelIds.length === 0 ? (
            <div className="p-8 text-center bg-white rounded-lg shadow">
              <Package className="w-12 h-12 mx-auto text-gray-300 mb-2" />
              <p className="text-gray-500">Otel secilmedi</p>
            </div>
          ) : (
            <div className="space-y-2">
              {selectedHotelIds.map((hotelId) => {
                const hotel = tenantsArray.find((t: Tenant) => t.id === hotelId);
                const hotelItems = itemsByHotel[hotelId] || [];
                const isActive = activeHotelId === hotelId;

                return (
                  <button
                    key={hotelId}
                    id={`hotel-section-${hotelId}`}
                    onClick={() => setActiveHotelId(hotelId)}
                    className={`w-full text-left rounded-xl p-4 transition-all border-2 ${
                      isActive
                        ? 'bg-gradient-to-r from-orange-500 to-orange-400 border-orange-500 shadow-lg'
                        : 'bg-white border-gray-200 hover:border-orange-300 hover:shadow-md'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Building2 className={`w-5 h-5 ${isActive ? 'text-white' : 'text-orange-500'}`} />
                        <span className={`font-bold ${isActive ? 'text-white' : 'text-gray-900'}`}>
                          {hotel?.name || 'Bilinmeyen'}
                        </span>
                      </div>
                      <div className={`text-right ${isActive ? 'text-white' : 'text-gray-600'}`}>
                        <span className="text-2xl font-bold">{hotelItems.length}</span>
                        <p className={`text-xs ${isActive ? 'text-orange-100' : 'text-gray-400'}`}>kirli</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Form Panel */}
        <div className="flex-1">
          {!activeHotelId ? (
            <div className="bg-white rounded-xl shadow-lg p-12 text-center border-2 border-dashed border-gray-300">
              <Sparkles className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <p className="text-xl font-semibold text-gray-500">Otel Secin</p>
              <p className="text-gray-400 mt-2">Sol taraftan bir otel secin</p>
            </div>
          ) : (() => {
            const hotelId = activeHotelId;
            const hotel = tenantsArray.find((t: Tenant) => t.id === hotelId);
            const hotelItems = itemsByHotel[hotelId] || [];
            const itemsByType = groupByType(hotelItems);

            return (
              <div className="bg-white rounded-xl shadow-lg overflow-hidden border-2 border-purple-200">
                {/* Hotel Header */}
                <div className="bg-gradient-to-r from-purple-600 to-purple-500 px-6 py-4">
                  <h3 className="text-xl font-bold text-white flex items-center gap-3">
                    <Building2 className="w-6 h-6" />
                    {hotel?.name || 'Bilinmeyen Otel'}
                  </h3>
                  <p className="text-purple-200 text-sm mt-1">{hotelItems.length} kirli urun</p>
                </div>

                {/* Form Content */}
                <div className="p-6">
                  <div className="space-y-4">
                    {/* Row 1: Dropdown */}
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
                        {(itemTypes || [])
                          .slice()
                          .sort((a: { id: string }, b: { id: string }) => {
                            const lastType = lastPrintedType[hotelId];
                            if (lastType === a.id) return -1;
                            if (lastType === b.id) return 1;
                            return 0;
                          })
                          .map((itemType: { id: string; name: string }) => {
                            const isLastPrinted = lastPrintedType[hotelId] === itemType.id;
                            return (
                              <option key={itemType.id} value={itemType.id}>
                                {isLastPrinted ? '★ ' : ''}{itemType.name}
                              </option>
                            );
                          })}
                      </select>
                    </div>

                    {/* Row 2: Adet counter + Numpad + Discord/Lekeli + Yazdir */}
                    <div className="flex items-start gap-4 justify-center flex-wrap">
                      {/* Adet display */}
                      <div className="bg-purple-100 rounded-lg p-4 text-center min-w-[100px]">
                        <p className="text-sm font-medium text-purple-600 mb-1">Adet</p>
                        <p className="text-4xl font-bold text-purple-700">{addingCount[hotelId] || 0}</p>
                      </div>

                      {/* Numpad */}
                      <div className="bg-gray-50 rounded-xl p-3 border-2 border-gray-300 shadow-md">
                        <div className="grid grid-cols-3 gap-2" style={{ width: '200px' }}>
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                            <button
                              type="button"
                              key={num}
                              onClick={() => setAddingCount(prev => ({ ...prev, [hotelId]: (prev[hotelId] || 0) * 10 + num }))}
                              className="h-14 w-14 rounded-lg font-bold text-2xl bg-white border-2 border-purple-300 text-gray-800 hover:bg-purple-100 active:bg-purple-200 transition-all shadow-sm"
                            >
                              {num}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => setAddingCount(prev => ({ ...prev, [hotelId]: 0 }))}
                            className="h-14 w-14 rounded-lg font-bold text-lg bg-red-100 text-red-700 border-2 border-red-400 hover:bg-red-200 shadow-sm"
                          >
                            C
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddingCount(prev => ({ ...prev, [hotelId]: (prev[hotelId] || 0) * 10 }))}
                            className="h-14 w-14 rounded-lg font-bold text-2xl bg-white border-2 border-purple-300 text-gray-800 hover:bg-purple-100 shadow-sm"
                          >
                            0
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddingCount(prev => ({ ...prev, [hotelId]: Math.floor((prev[hotelId] || 0) / 10) }))}
                            className="h-14 w-14 rounded-lg font-bold bg-gray-200 border-2 border-gray-400 text-gray-700 hover:bg-gray-300 flex items-center justify-center shadow-sm"
                          >
                            <Delete className="w-6 h-6" />
                          </button>
                        </div>
                      </div>

                      {/* Discord and Lekeli */}
                      <div className="flex flex-col gap-2">
                        {/* Discord section */}
                        <div className={`rounded-lg p-3 border-2 transition-all ${addingDiscard[hotelId] ? 'bg-blue-50 border-blue-300' : 'bg-gray-50 border-gray-200'}`}>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={addingDiscard[hotelId] || false}
                              onChange={(e) => {
                                setAddingDiscard(prev => ({ ...prev, [hotelId]: e.target.checked }));
                                if (e.target.checked) {
                                  setAddingDiscardCount(prev => ({ ...prev, [hotelId]: 1 }));
                                  setAddingHasarli(prev => ({ ...prev, [hotelId]: false }));
                                  setAddingHasarliCount(prev => ({ ...prev, [hotelId]: 0 }));
                                } else {
                                  setAddingDiscardCount(prev => ({ ...prev, [hotelId]: 0 }));
                                }
                              }}
                              className="w-5 h-5 text-blue-600 rounded"
                            />
                            <span className={`font-bold ${addingDiscard[hotelId] ? 'text-blue-700' : 'text-gray-500'}`}>Discord</span>
                            {addingDiscard[hotelId] && (
                              <div className="flex items-center gap-1 ml-2">
                                <button
                                  onClick={(e) => { e.preventDefault(); setAddingDiscardCount(prev => ({ ...prev, [hotelId]: Math.max(0, (prev[hotelId] || 0) - 1) })); }}
                                  className="w-7 h-7 bg-blue-100 text-blue-700 rounded font-bold hover:bg-blue-200"
                                >
                                  -
                                </button>
                                <span className="w-8 text-center text-lg font-bold text-blue-700">{addingDiscardCount[hotelId] || 0}</span>
                                <button
                                  onClick={(e) => { e.preventDefault(); setAddingDiscardCount(prev => ({ ...prev, [hotelId]: (prev[hotelId] || 0) + 1 })); }}
                                  className="w-7 h-7 bg-blue-100 text-blue-700 rounded font-bold hover:bg-blue-200"
                                >
                                  +
                                </button>
                              </div>
                            )}
                          </label>
                        </div>

                        {/* Lekeli section */}
                        <div className={`rounded-lg p-3 border-2 transition-all ${addingHasarli[hotelId] ? 'bg-red-50 border-red-300' : 'bg-gray-50 border-gray-200'}`}>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={addingHasarli[hotelId] || false}
                              onChange={(e) => {
                                setAddingHasarli(prev => ({ ...prev, [hotelId]: e.target.checked }));
                                if (e.target.checked) {
                                  setAddingHasarliCount(prev => ({ ...prev, [hotelId]: 1 }));
                                  setAddingDiscard(prev => ({ ...prev, [hotelId]: false }));
                                  setAddingDiscardCount(prev => ({ ...prev, [hotelId]: 0 }));
                                } else {
                                  setAddingHasarliCount(prev => ({ ...prev, [hotelId]: 0 }));
                                }
                              }}
                              className="w-5 h-5 text-red-600 rounded"
                            />
                            <span className={`font-bold ${addingHasarli[hotelId] ? 'text-red-700' : 'text-gray-500'}`}>Lekeli</span>
                            {addingHasarli[hotelId] && (
                              <div className="flex items-center gap-1 ml-2">
                                <button
                                  onClick={(e) => { e.preventDefault(); setAddingHasarliCount(prev => ({ ...prev, [hotelId]: Math.max(0, (prev[hotelId] || 0) - 1) })); }}
                                  className="w-7 h-7 bg-red-100 text-red-700 rounded font-bold hover:bg-red-200"
                                >
                                  -
                                </button>
                                <span className="w-8 text-center text-lg font-bold text-red-700">{addingHasarliCount[hotelId] || 0}</span>
                                <button
                                  onClick={(e) => { e.preventDefault(); setAddingHasarliCount(prev => ({ ...prev, [hotelId]: (prev[hotelId] || 0) + 1 })); }}
                                  className="w-7 h-7 bg-red-100 text-red-700 rounded font-bold hover:bg-red-200"
                                >
                                  +
                                </button>
                              </div>
                            )}
                          </label>
                        </div>
                      </div>

                      {/* Print Button */}
                      <button
                        onClick={() => {
                          const typeId = addingTypeId[hotelId];
                          const count = addingCount[hotelId] || 0;
                          const hasDiscard = addingDiscard[hotelId] || false;
                          const discardCount = hasDiscard ? (addingDiscardCount[hotelId] || 0) : 0;
                          const hasHasarli = addingHasarli[hotelId] || false;
                          const hasarliCount = hasHasarli ? (addingHasarliCount[hotelId] || 0) : 0;

                          if (!typeId) {
                            toast.warning('Lutfen urun turu secin');
                            return;
                          }

                          if (count <= 0) {
                            toast.warning('Lutfen adet girin');
                            return;
                          }

                          const availableItems = itemsByType[typeId] || [];

                          const newLastPrintedType = { ...lastPrintedType, [hotelId]: typeId };
                          setLastPrintedType(newLastPrintedType);
                          localStorage.setItem(LAST_PRINTED_TYPE_KEY, JSON.stringify(newLastPrintedType));

                          const itemIds = availableItems.slice(0, count).map(i => i.id);
                          const itemType = itemTypes?.find((t: { id: string; name: string }) => t.id === typeId);

                          processAndPrintMutation.mutate({
                            hotelId,
                            itemIds,
                            labelCount: 1,
                            labelExtraData: [{
                              typeId,
                              typeName: itemType?.name || 'Bilinmeyen',
                              count: count,
                              discardCount,
                              hasarliCount
                            }]
                          });

                          setAddingTypeId(prev => ({ ...prev, [hotelId]: '' }));
                          setAddingCount(prev => ({ ...prev, [hotelId]: 0 }));
                          setAddingDiscard(prev => ({ ...prev, [hotelId]: false }));
                          setAddingDiscardCount(prev => ({ ...prev, [hotelId]: 0 }));
                          setAddingHasarli(prev => ({ ...prev, [hotelId]: false }));
                          setAddingHasarliCount(prev => ({ ...prev, [hotelId]: 0 }));
                        }}
                        disabled={!addingTypeId[hotelId] || processAndPrintMutation.isPending}
                        className="h-32 px-8 flex flex-col items-center justify-center gap-2 bg-gradient-to-b from-purple-600 to-purple-700 text-white rounded-xl hover:from-purple-700 hover:to-purple-800 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed font-bold text-xl transition-all shadow-lg"
                      >
                        <Printer className="w-8 h-8" />
                        {processAndPrintMutation.isPending ? 'Yazdiriliyor...' : 'YAZDIR'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
