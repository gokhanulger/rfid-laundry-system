import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Printer, Sparkles, Building2, X, Plus, Search, Delete, Trash2, Sun, Moon } from 'lucide-react';
import { itemsApi, deliveriesApi, settingsApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import { generateDeliveryLabel } from '../lib/pdfGenerator';
import type { Item, Tenant } from '../types';

// Storage keys
const SELECTED_HOTELS_KEY = 'laundry_selected_hotels';
const LAST_PRINTED_TYPE_KEY = 'laundry_last_printed_type';
const PRODUCT_COUNTER_KEY = 'laundry_product_counter';

// Shift type
type ShiftType = 'day' | 'night';

// Get current shift based on Turkey time (UTC+3)
// Day: 08:00 - 18:00, Night: 18:00 - 08:00
function getCurrentShiftTurkey(): ShiftType {
  const now = new Date();
  // Get Turkey time (UTC+3)
  const turkeyHour = (now.getUTCHours() + 3) % 24;
  // Day shift: 8 AM (08:00) to 6 PM (18:00)
  if (turkeyHour >= 8 && turkeyHour < 18) {
    return 'day';
  }
  return 'night';
}

// Type for print list items
interface PrintListItem {
  typeId: string;
  typeName: string;
  count: number;
  discardCount: number;
  hasarliCount: number;
}

export function IronerInterfacePage() {
  const [selectedHotelIds, setSelectedHotelIds] = useState<string[]>([]);
  const [isWorking, setIsWorking] = useState(false); // True when user confirmed hotel selection
  const [showHotelSelector, setShowHotelSelector] = useState(false);
  // For the add item form per hotel
  const [addingTypeId, setAddingTypeId] = useState<Record<string, string>>({});
  const [addingCount, setAddingCount] = useState<Record<string, number>>({});
  // Discard and hasarli state per hotel (checkbox only, no count)
  const [addingDiscard, setAddingDiscard] = useState<Record<string, boolean>>({});
  const [addingHasarli, setAddingHasarli] = useState<Record<string, boolean>>({});
  // Last printed item type per hotel for dropdown sorting
  const [lastPrintedType, setLastPrintedType] = useState<Record<string, string>>({});
  // Hotel search filter
  const [hotelSearchFilter, setHotelSearchFilter] = useState('');
  // Active hotel for the right panel form
  const [activeHotelId, setActiveHotelId] = useState<string | null>(null);
  // Print list per hotel - accumulates items before printing
  const [printList, setPrintList] = useState<Record<string, PrintListItem[]>>({});
  // Product counter per shift (counts products, not labels)
  const [productCounter, setProductCounter] = useState<{ day: number; night: number }>({ day: 0, night: 0 });
  // Current shift - auto-detected based on Turkey time
  const [currentShift, setCurrentShift] = useState<ShiftType>(getCurrentShiftTurkey());
  const queryClient = useQueryClient();
  const toast = useToast();

  // Load selected hotels from localStorage on mount
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

    const savedLastPrintedType = localStorage.getItem(LAST_PRINTED_TYPE_KEY);
    if (savedLastPrintedType) {
      try {
        setLastPrintedType(JSON.parse(savedLastPrintedType));
      } catch {
        // Ignore parse errors
      }
    }

    // Load product counter
    const loadCounter = () => {
      const savedCounter = localStorage.getItem(PRODUCT_COUNTER_KEY);
      if (savedCounter) {
        try {
          setProductCounter(JSON.parse(savedCounter));
        } catch {
          // Ignore parse errors
        }
      }
    };
    loadCounter();

    // Auto-detect shift based on Turkey time and update every minute
    const updateShift = () => setCurrentShift(getCurrentShiftTurkey());
    updateShift();

    // Refresh counter and shift every 5 seconds (to catch packager updates)
    const refreshInterval = setInterval(() => {
      loadCounter();
      updateShift();
    }, 5000);
    return () => clearInterval(refreshInterval);
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

  // Add item to print list
  const addToPrintList = (hotelId: string, item: PrintListItem) => {
    setPrintList(prev => {
      const currentList = prev[hotelId] || [];
      // Check if same type already exists, if so update count
      const existingIndex = currentList.findIndex(i => i.typeId === item.typeId);
      if (existingIndex >= 0) {
        const updated = [...currentList];
        updated[existingIndex] = {
          ...updated[existingIndex],
          count: updated[existingIndex].count + item.count,
          discardCount: updated[existingIndex].discardCount + item.discardCount,
          hasarliCount: updated[existingIndex].hasarliCount + item.hasarliCount,
        };
        return { ...prev, [hotelId]: updated };
      }
      return { ...prev, [hotelId]: [...currentList, item] };
    });
  };

  // Remove item from print list
  const removeFromPrintList = (hotelId: string, typeId: string) => {
    setPrintList(prev => {
      const currentList = prev[hotelId] || [];
      return { ...prev, [hotelId]: currentList.filter(i => i.typeId !== typeId) };
    });
  };

  // Clear print list for a hotel
  const clearPrintList = (hotelId: string) => {
    setPrintList(prev => ({ ...prev, [hotelId]: [] }));
  };

  // Get dirty items (at_laundry or processing status)
  const { data: dirtyItems, refetch: refetchDirty } = useQuery({
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

      // Calculate total product count from labelExtraData
      const totalProducts = (labelExtraData || []).reduce((sum, item) => sum + (item.count || 0), 0);
      return { delivery: fullDelivery, labelCount, totalProducts };
    },
    onSuccess: () => {
      toast.success('Urunler temizlendi ve etiket basildi!');
      // Counter now increments when packager scans the label
      queryClient.invalidateQueries({ queryKey: ['dirty-items'] });
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      refetchDirty();
      refetchPrinted();
    },
    onError: (err) => toast.error('Failed to process items', getErrorMessage(err)),
  });

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
            <div className="p-3 bg-orange-100 rounded-lg">
              <Printer className="w-8 h-8 text-orange-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">RFID Çamaşırhane</h1>
              <p className="text-sm text-gray-500">by Karbeyaz & Demet Laundry</p>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <Building2 className="w-16 h-16 text-orange-300 mx-auto mb-4" />
            <p className="text-xl text-gray-500 mb-2">Otel secilmedi</p>
            <p className="text-gray-400">Baslamak icin otelleri secin</p>
          </div>
        </div>
        <HotelSelectionDialog />
      </>
    );
  }

  return (
    <div className="h-full animate-fade-in">
      {/* Main Content */}
      <div className="p-8 space-y-6 overflow-auto h-full">
        {/* Header with Hotels and Counter */}
        <div className="flex items-center justify-between gap-4 sticky top-0 z-40 bg-white py-2">
          {/* Left: Logo and Title */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="p-3 bg-orange-100 rounded-lg">
              <Printer className="w-8 h-8 text-orange-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">RFID Çamaşırhane</h1>
              <p className="text-sm text-gray-500">by Karbeyaz & Demet Laundry</p>
            </div>
          </div>

          {/* Center: Selected Hotels */}
          <div className="flex-1 flex items-center gap-2 flex-wrap justify-center">
            {selectedHotelIds.map(hotelId => {
              const hotel = tenantsArray.find((t: Tenant) => t.id === hotelId);
              const isActive = activeHotelId === hotelId;
              return (
                <div
                  key={hotelId}
                  className={`flex items-center gap-1 pl-3 pr-1 py-1 rounded-full border transition-all ${
                    isActive
                      ? 'bg-orange-600 border-orange-600 text-white'
                      : 'bg-orange-50 border-orange-200 hover:bg-orange-100'
                  }`}
                >
                  <button
                    onClick={() => setActiveHotelId(hotelId)}
                    className="flex items-center gap-2"
                  >
                    <Building2 className={`w-4 h-4 ${isActive ? 'text-white' : 'text-orange-600'}`} />
                    <span className={`font-medium text-sm ${isActive ? 'text-white' : 'text-gray-900'}`}>{hotel?.name}</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const newSelection = selectedHotelIds.filter(id => id !== hotelId);
                      saveSelectedHotels(newSelection);
                      if (activeHotelId === hotelId) {
                        setActiveHotelId(null);
                      }
                    }}
                    className={`ml-1 p-1 rounded-full transition-colors ${
                      isActive
                        ? 'hover:bg-orange-500 text-white'
                        : 'hover:bg-red-100 text-gray-400 hover:text-red-600'
                    }`}
                    title="Oteli kaldir"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
            <button
              onClick={() => setShowHotelSelector(true)}
              className="flex items-center gap-1 text-orange-600 hover:text-orange-700 text-sm font-medium px-2 py-1"
            >
              <Plus className="w-4 h-4" />
              Otel Ekle
            </button>
          </div>

          {/* Right: Counter */}
          <div className="flex items-center gap-4 bg-gray-900 text-white rounded-xl px-6 py-3 flex-shrink-0">
            <div className={`flex items-center gap-2 py-1 px-3 rounded-lg ${
              currentShift === 'day'
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-indigo-500/20 text-indigo-400'
            }`}>
              {currentShift === 'day' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              <span className="font-medium text-sm">
                {currentShift === 'day' ? 'Gündüz' : 'Gece'}
              </span>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-white">
                {productCounter[currentShift]}
              </p>
              <p className="text-xs text-gray-400">ürün işlendi</p>
            </div>
            <div className="border-l border-gray-700 pl-4">
              <p className="text-xs text-gray-500">
                {currentShift === 'day' ? 'Gece' : 'Gündüz'}: {productCounter[currentShift === 'day' ? 'night' : 'day']}
              </p>
            </div>
          </div>
        </div>

      {/* Hotel Selection Dialog */}
      {showHotelSelector && <HotelSelectionDialog />}

      {/* Main Content: Form Panel */}
      {!activeHotelId ? (
        <div className="bg-white rounded-xl shadow-lg p-12 text-center border-2 border-dashed border-orange-300 max-w-2xl mx-auto">
          <Sparkles className="w-16 h-16 mx-auto text-orange-300 mb-4" />
          <p className="text-xl font-semibold text-gray-500">Otel Secin</p>
          <p className="text-gray-400 mt-2">Yukaridaki otellerden birini secin</p>
        </div>
      ) : (() => {
        const hotelId = activeHotelId;
        const hotel = tenantsArray.find((t: Tenant) => t.id === hotelId);
        const hotelItems = itemsByHotel[hotelId] || [];
        const itemsByType = groupByType(hotelItems);
        const currentPrintList = printList[hotelId] || [];

        return (
          <div className="flex gap-6">
            {/* Left Panel: Print List (only shown when items are added) */}
            {currentPrintList.length > 0 && (
              <div className="w-72 flex-shrink-0">
                <div className="bg-white rounded-xl shadow-lg border-2 border-green-200 overflow-hidden">
                  <div className="bg-gradient-to-r from-green-600 to-green-500 px-4 py-3 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-white">Ekleneler</h3>
                    <button
                      onClick={() => clearPrintList(hotelId)}
                      className="p-1 text-green-100 hover:text-white hover:bg-green-700 rounded"
                      title="Listeyi temizle"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="p-3 space-y-2 max-h-96 overflow-y-auto">
                    {currentPrintList.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-green-50 rounded-lg p-3 border border-green-200">
                        <div>
                          <p className="font-bold text-gray-900">{item.typeName}</p>
                          <p className="text-sm text-green-700">{item.count} adet</p>
                          {item.discardCount > 0 && <p className="text-xs text-blue-600">Discord: {item.discardCount}</p>}
                          {item.hasarliCount > 0 && <p className="text-xs text-red-600">Lekeli: {item.hasarliCount}</p>}
                        </div>
                        <button
                          onClick={() => removeFromPrintList(hotelId, item.typeId)}
                          className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="p-3 border-t bg-gray-50">
                    <p className="text-sm text-gray-600 text-center">
                      Toplam: <span className="font-bold text-green-700">{currentPrintList.reduce((sum, i) => sum + i.count, 0)}</span> adet
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Right Panel: Form */}
            <div className="flex-1">
              <div className="bg-white rounded-xl shadow-lg overflow-hidden border-2 border-orange-200">
                {/* Hotel Header */}
                <div className="bg-gradient-to-r from-orange-600 to-orange-500 px-6 py-4">
                  <h3 className="text-xl font-bold text-white flex items-center gap-3">
                    <Building2 className="w-6 h-6" />
                    {hotel?.name || 'Bilinmeyen Otel'}
                  </h3>
                  <p className="text-orange-200 text-sm mt-1">{hotelItems.length} kirli urun</p>
                </div>

                {/* Form Content */}
                <div className="p-6">
                  <div className="space-y-4">
                    {/* All in one row: Adet + Numpad + Discord/Lekeli + Dropdown + Buttons */}
                    <div className="flex items-start gap-4 justify-center flex-wrap">
                      {/* Adet display */}
                      <div className="bg-orange-100 rounded-lg p-4 text-center min-w-[100px]">
                        <p className="text-sm font-medium text-orange-600 mb-1">Adet</p>
                        <p className="text-4xl font-bold text-orange-700">{addingCount[hotelId] || 0}</p>
                      </div>

                      {/* Numpad */}
                      <div className="bg-gray-50 rounded-xl p-3 border-2 border-gray-300 shadow-md">
                        <div className="grid grid-cols-3 gap-2" style={{ width: '200px' }}>
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                            <button
                              type="button"
                              key={num}
                              onClick={() => setAddingCount(prev => ({ ...prev, [hotelId]: (prev[hotelId] || 0) * 10 + num }))}
                              className="h-14 w-14 rounded-lg font-bold text-2xl bg-white border-2 border-orange-300 text-gray-800 hover:bg-orange-100 active:bg-orange-200 transition-all shadow-sm"
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
                            className="h-14 w-14 rounded-lg font-bold text-2xl bg-white border-2 border-orange-300 text-gray-800 hover:bg-orange-100 shadow-sm"
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

                      {/* Discord and Lekeli - simple checkboxes */}
                      <div className="flex flex-col gap-2">
                        {/* Discord section */}
                        <div className={`rounded-lg p-3 border-2 transition-all ${addingDiscard[hotelId] ? 'bg-blue-100 border-blue-400' : 'bg-gray-50 border-gray-200'}`}>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={addingDiscard[hotelId] || false}
                              onChange={(e) => {
                                setAddingDiscard(prev => ({ ...prev, [hotelId]: e.target.checked }));
                                if (e.target.checked) {
                                  setAddingHasarli(prev => ({ ...prev, [hotelId]: false }));
                                }
                              }}
                              className="w-6 h-6 text-blue-600 rounded"
                            />
                            <span className={`font-bold text-lg ${addingDiscard[hotelId] ? 'text-blue-700' : 'text-gray-500'}`}>DISCORD</span>
                          </label>
                        </div>

                        {/* Lekeli section */}
                        <div className={`rounded-lg p-3 border-2 transition-all ${addingHasarli[hotelId] ? 'bg-red-100 border-red-400' : 'bg-gray-50 border-gray-200'}`}>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={addingHasarli[hotelId] || false}
                              onChange={(e) => {
                                setAddingHasarli(prev => ({ ...prev, [hotelId]: e.target.checked }));
                                if (e.target.checked) {
                                  setAddingDiscard(prev => ({ ...prev, [hotelId]: false }));
                                }
                              }}
                              className="w-6 h-6 text-red-600 rounded"
                            />
                            <span className={`font-bold text-lg ${addingHasarli[hotelId] ? 'text-red-700' : 'text-gray-500'}`}>LEKELİ</span>
                          </label>
                        </div>
                      </div>

                      {/* Dropdown + Buttons */}
                      <div className="flex flex-col gap-2">
                        {/* Dropdown */}
                        <select
                          value={addingTypeId[hotelId] || ''}
                          onChange={(e) => setAddingTypeId(prev => ({ ...prev, [hotelId]: e.target.value }))}
                          className="w-48 px-3 py-2 border-2 border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                        >
                          <option value="">Tür seçin...</option>
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

                        {/* Add Button */}
                        <button
                          onClick={() => {
                            const typeId = addingTypeId[hotelId];
                            const count = addingCount[hotelId] || 0;
                            const hasDiscard = addingDiscard[hotelId] || false;
                            const hasHasarli = addingHasarli[hotelId] || false;
                            // Discord/Lekeli: just mark as 1 if selected (for special label)
                            const discardCount = hasDiscard ? 1 : 0;
                            const hasarliCount = hasHasarli ? 1 : 0;

                            if (!typeId) {
                              toast.warning('Lutfen urun turu secin');
                              return;
                            }

                            if (count <= 0) {
                              toast.warning('Lutfen adet girin');
                              return;
                            }

                            const itemType = itemTypes?.find((t: { id: string; name: string }) => t.id === typeId);

                            // Add to print list
                            addToPrintList(hotelId, {
                              typeId,
                              typeName: itemType?.name || 'Bilinmeyen',
                              count,
                              discardCount,
                              hasarliCount
                            });

                            toast.success(`${count} adet ${itemType?.name || 'urun'} eklendi`);

                            // Update last printed type for sorting
                            const newLastPrintedType = { ...lastPrintedType, [hotelId]: typeId };
                            setLastPrintedType(newLastPrintedType);
                            localStorage.setItem(LAST_PRINTED_TYPE_KEY, JSON.stringify(newLastPrintedType));

                            // Reset form for next entry
                            setAddingTypeId(prev => ({ ...prev, [hotelId]: '' }));
                            setAddingCount(prev => ({ ...prev, [hotelId]: 0 }));
                            setAddingDiscard(prev => ({ ...prev, [hotelId]: false }));
                            setAddingHasarli(prev => ({ ...prev, [hotelId]: false }));
                          }}
                          disabled={!addingTypeId[hotelId] || (addingCount[hotelId] || 0) <= 0}
                          className="h-14 px-6 flex items-center justify-center gap-2 bg-gradient-to-b from-green-500 to-green-600 text-white rounded-xl hover:from-green-600 hover:to-green-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed font-bold text-lg transition-all shadow-lg"
                        >
                          <Plus className="w-5 h-5" />
                          EKLE
                        </button>

                        {/* Print Button - prints all items in print list */}
                        {/* If form has data, auto-add it before printing */}
                        <button
                          onClick={() => {
                            let itemsToPrint = [...(printList[hotelId] || [])];

                            // Validate form - check for incomplete entries
                            const currentTypeId = addingTypeId[hotelId];
                            const currentCount = addingCount[hotelId] || 0;

                            // Warning if type selected but no count
                            if (currentTypeId && currentCount <= 0) {
                              toast.warning('Tur secildi ama adet girilmedi!');
                              return;
                            }

                            // Warning if count entered but no type selected
                            if (!currentTypeId && currentCount > 0) {
                              toast.warning('Adet girildi ama tur secilmedi!');
                              return;
                            }

                            // Auto-add current form data if filled
                            if (currentTypeId && currentCount > 0) {
                              const itemType = itemTypes?.find((t: { id: string; name: string }) => t.id === currentTypeId);
                              const hasDiscard = addingDiscard[hotelId] || false;
                              const discardCount = hasDiscard ? 1 : 0;
                              const hasHasarli = addingHasarli[hotelId] || false;
                              const hasarliCount = hasHasarli ? 1 : 0;

                              // Check if same type already in list
                              const existingIdx = itemsToPrint.findIndex(i => i.typeId === currentTypeId);
                              if (existingIdx >= 0) {
                                itemsToPrint[existingIdx] = {
                                  ...itemsToPrint[existingIdx],
                                  count: itemsToPrint[existingIdx].count + currentCount,
                                  discardCount: itemsToPrint[existingIdx].discardCount + discardCount,
                                  hasarliCount: itemsToPrint[existingIdx].hasarliCount + hasarliCount,
                                };
                              } else {
                                itemsToPrint.push({
                                  typeId: currentTypeId,
                                  typeName: itemType?.name || 'Bilinmeyen',
                                  count: currentCount,
                                  discardCount,
                                  hasarliCount
                                });
                              }

                              // Clear form after auto-add
                              setAddingTypeId(prev => ({ ...prev, [hotelId]: '' }));
                              setAddingCount(prev => ({ ...prev, [hotelId]: 0 }));
                              setAddingDiscard(prev => ({ ...prev, [hotelId]: false }));
                              setAddingHasarli(prev => ({ ...prev, [hotelId]: false }));
                            }

                            if (itemsToPrint.length === 0) {
                              toast.warning('Lutfen urun turu ve adet girin');
                              return;
                            }

                            // Collect all item IDs from dirty items
                            const allItemIds: string[] = [];
                            itemsToPrint.forEach(item => {
                              const availableItems = itemsByType[item.typeId] || [];
                              allItemIds.push(...availableItems.slice(0, item.count).map(i => i.id));
                            });

                            processAndPrintMutation.mutate({
                              hotelId,
                              itemIds: allItemIds,
                              labelCount: 1,
                              labelExtraData: itemsToPrint.map(item => ({
                                typeId: item.typeId,
                                typeName: item.typeName,
                                count: item.count,
                                discardCount: item.discardCount,
                                hasarliCount: item.hasarliCount
                              }))
                            });

                            // Clear print list after printing
                            clearPrintList(hotelId);
                          }}
                          disabled={processAndPrintMutation.isPending}
                          className="h-14 px-6 flex items-center justify-center gap-2 bg-gradient-to-b from-orange-500 to-orange-600 text-white rounded-xl hover:from-orange-600 hover:to-orange-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed font-bold text-lg transition-all shadow-lg"
                        >
                          <Printer className="w-5 h-5" />
                          {processAndPrintMutation.isPending ? 'Yazdiriliyor...' : 'YAZDIR'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      </div>
    </div>
  );
}
