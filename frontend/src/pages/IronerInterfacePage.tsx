import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Printer, Sparkles, Building2, X, Plus, Search, Delete, Trash2, Sun, Moon, Settings, Wifi, WifiOff, Radio, AlertTriangle, CheckCircle, HelpCircle, XCircle, RefreshCw, Loader2 } from 'lucide-react';
import { itemsApi, deliveriesApi, settingsApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import { generateDeliveryLabel } from '../lib/pdfGenerator';
import { isElectron, getPrinters, savePreferredPrinter, getPreferredPrinter, type Printer as PrinterType } from '../lib/printer';
import type { Item, Tenant } from '../types';
import type { UhfTag, UhfReaderStatus } from '../types/electron';

// Storage keys
const SELECTED_HOTELS_KEY = 'laundry_selected_hotels';
const LAST_PRINTED_TYPE_KEY = 'laundry_last_printed_type';
const PRODUCT_COUNTER_KEY = 'laundry_product_counter';

// Shift type
type ShiftType = 'day' | 'night';

// Scanned tag status
type TagStatus = 'valid' | 'wrong_hotel' | 'unregistered' | 'checking';

// Scanned tag with validation info
interface ScannedTagInfo {
  epc: string;
  status: TagStatus;
  hotelId?: string;
  hotelName?: string;
  itemType?: string;
  itemTypeId?: string;
  itemId?: string;
  lastSeen: number;
  rssi?: number;
}

// Tag timeout - consider tag "left" after 3 seconds of no reads
const TAG_TIMEOUT_MS = 3000;

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
  // Printer selection
  const [availablePrinters, setAvailablePrinters] = useState<PrinterType[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>(getPreferredPrinter() || '');
  const [showPrinterModal, setShowPrinterModal] = useState(false);

  // UHF RFID Reader state
  const [uhfConnected, setUhfConnected] = useState(false);
  const [uhfInventoryActive, setUhfInventoryActive] = useState(false);
  const [scannedTags, setScannedTags] = useState<Map<string, ScannedTagInfo>>(new Map());
  // Confirmed scanned items - persists until label is printed
  const [confirmedScannedItems, setConfirmedScannedItems] = useState<Map<string, ScannedTagInfo>>(new Map());
  const [showPrintConfirmModal, setShowPrintConfirmModal] = useState(false);
  const [pendingPrintAction, setPendingPrintAction] = useState<(() => void) | null>(null);

  // RFID Reader Settings
  const [showRfidSettingsModal, setShowRfidSettingsModal] = useState(false);
  const [rfidReaderIp, setRfidReaderIp] = useState<string>('');
  const [rfidReaderPort, setRfidReaderPort] = useState<number>(0);
  const [rfidScanProgress, setRfidScanProgress] = useState<{ status: string; message?: string; ip?: string; port?: number } | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [manualIp, setManualIp] = useState('');
  const [manualPort, setManualPort] = useState('20058');

  // Ref to track which EPCs are currently being validated (prevents duplicate API calls)
  const validatingEpcsRef = useRef<Set<string>>(new Set());

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

    // Load available printers (Electron only)
    if (isElectron()) {
      getPrinters().then(printers => {
        setAvailablePrinters(printers);
        // If no printer selected yet, use default
        if (!getPreferredPrinter() && printers.length > 0) {
          const defaultPrinter = printers.find(p => p.isDefault)?.name || printers[0].name;
          setSelectedPrinter(defaultPrinter);
          savePreferredPrinter(defaultPrinter);
        }
      });

      // Load saved RFID reader IP from localStorage
      const savedIp = localStorage.getItem('rfid_reader_ip');
      const savedPort = localStorage.getItem('rfid_reader_port');
      if (savedIp) {
        setManualIp(savedIp);
        setRfidReaderIp(savedIp);
        // Update Electron config with saved IP
        window.electronAPI?.uhfSetConfig({
          ip: savedIp,
          port: savedPort ? parseInt(savedPort) : 20058
        });
      }
      if (savedPort) {
        setManualPort(savedPort);
        setRfidReaderPort(parseInt(savedPort));
      }
    }

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

  // Validate scanned tag against database
  const validateTag = useCallback(async (epc: string): Promise<ScannedTagInfo> => {
    try {
      const item = await itemsApi.getByRfid(epc);

      // If item is null or undefined, it's unregistered
      if (!item) {
        return {
          epc,
          status: 'unregistered',
          lastSeen: Date.now(),
        };
      }

      const hotel = tenantsArray.find((t: Tenant) => t.id === item.tenantId);
      const itemTypeInfo = itemTypes?.find((t: { id: string; name: string }) => t.id === item.itemTypeId);

      // Check if tag belongs to selected hotel
      const isValidHotel = activeHotelId ? item.tenantId === activeHotelId : selectedHotelIds.includes(item.tenantId);

      return {
        epc,
        status: isValidHotel ? 'valid' : 'wrong_hotel',
        hotelId: item.tenantId,
        hotelName: hotel?.name || 'Bilinmeyen Otel',
        itemType: itemTypeInfo?.name || 'Bilinmeyen Tür',
        itemTypeId: item.itemTypeId,
        itemId: item.id,
        lastSeen: Date.now(),
      };
    } catch (error: unknown) {
      // Check if it's a 404 error (not found) - only then mark as unregistered
      const axiosError = error as { response?: { status?: number } };
      if (axiosError?.response?.status === 404) {
        return {
          epc,
          status: 'unregistered',
          lastSeen: Date.now(),
        };
      }

      // For other errors (network, timeout, etc.), keep as checking to retry
      return {
        epc,
        status: 'checking',
        lastSeen: Date.now(),
      };
    }
  }, [activeHotelId, selectedHotelIds, tenantsArray, itemTypes]);

  // UHF Reader setup - connect and listen for status/tags
  useEffect(() => {
    if (!window.electronAPI) return;

    // Get initial status
    window.electronAPI.uhfGetStatus().then((status: UhfReaderStatus) => {
      setUhfConnected(status.connected);
      setUhfInventoryActive(status.inventoryActive || false);
      if (status.ip) setRfidReaderIp(status.ip);
      if (status.port) setRfidReaderPort(status.port);
    });

    // Listen for status changes
    const unsubStatus = window.electronAPI.onUhfStatus((status: UhfReaderStatus) => {
      setUhfConnected(status.connected);
      setUhfInventoryActive(status.inventoryActive || false);
      if (status.ip) setRfidReaderIp(status.ip);
    });

    // Listen for scan progress
    const unsubScanProgress = window.electronAPI.onUhfScanProgress((progress: { status: string; message?: string; ip?: string; port?: number }) => {
      setRfidScanProgress(progress);
      if (progress.status === 'found' || progress.status === 'not_found') {
        setIsScanning(false);
        if (progress.ip && progress.port) {
          setRfidReaderIp(progress.ip);
          setRfidReaderPort(progress.port);
        }
      }
    });

    // Listen for tag reads
    const unsubTag = window.electronAPI.onUhfTag(async (tag: UhfTag) => {
      // Check if already validating this EPC (prevent duplicate API calls)
      if (validatingEpcsRef.current.has(tag.epc)) {
        // Just update last seen time
        setScannedTags(prev => {
          const newMap = new Map(prev);
          const existing = newMap.get(tag.epc);
          if (existing) {
            newMap.set(tag.epc, { ...existing, lastSeen: Date.now(), rssi: tag.rssi });
          }
          return newMap;
        });
        return;
      }

      // Check if already validated (exists with non-checking status)
      let needsValidation = true;
      setScannedTags(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(tag.epc);
        if (existing) {
          // Update last seen time
          newMap.set(tag.epc, { ...existing, lastSeen: Date.now(), rssi: tag.rssi });
          // Only skip validation if already validated successfully
          if (existing.status !== 'checking') {
            needsValidation = false;
          }
        } else {
          // New tag - mark as checking
          newMap.set(tag.epc, {
            epc: tag.epc,
            status: 'checking',
            lastSeen: Date.now(),
            rssi: tag.rssi
          });
        }
        return newMap;
      });

      // Skip validation if already validated
      if (!needsValidation) {
        return;
      }

      // Mark as validating
      validatingEpcsRef.current.add(tag.epc);

      try {
        const validated = await validateTag(tag.epc);
        setScannedTags(prev => {
          const newMap = new Map(prev);
          newMap.set(tag.epc, validated);
          return newMap;
        });

        // Add valid and wrong_hotel tags to confirmed items (only if new tag)
        // All types are tracked in confirmedScannedItems for display
        if ((validated.status === 'valid' || validated.status === 'wrong_hotel') && validated.itemTypeId && validated.hotelId) {
          // Check if already added using a ref-like approach
          setConfirmedScannedItems(prev => {
            if (prev.has(tag.epc)) {
              // Already added, skip
              return prev;
            }

            // Add to confirmed items (all types - valid, wrong_hotel, already_processed)
            const newMap = new Map(prev);
            newMap.set(tag.epc, validated);
            return newMap;
          });
        }

        // Remove from validating set after successful validation (not checking)
        if (validated.status !== 'checking') {
          validatingEpcsRef.current.delete(tag.epc);
        }
      } catch (err) {
        validatingEpcsRef.current.delete(tag.epc);
      }
    });

    return () => {
      unsubStatus();
      unsubTag();
      unsubScanProgress();
    };
  }, [validateTag]);

  // Cleanup old tags that haven't been seen recently
  // Also sync confirmedScannedItems - remove items that are no longer in range
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();

      // First, find timed out EPCs from scannedTags
      setScannedTags(prev => {
        const timedOutEpcs: string[] = [];
        const newMap = new Map(prev);
        let changed = false;

        prev.forEach((tag, epc) => {
          if (now - tag.lastSeen > TAG_TIMEOUT_MS) {
            newMap.delete(epc);
            timedOutEpcs.push(epc);
            changed = true;
          }
        });

        // Remove timed out tags from confirmedScannedItems immediately
        if (timedOutEpcs.length > 0) {
          setConfirmedScannedItems(prevConfirmed => {
            const newConfirmedMap = new Map(prevConfirmed);
            let confirmedChanged = false;
            timedOutEpcs.forEach(epc => {
              if (newConfirmedMap.has(epc)) {
                newConfirmedMap.delete(epc);
                confirmedChanged = true;
              }
            });
            return confirmedChanged ? newConfirmedMap : prevConfirmed;
          });
        }

        return changed ? newMap : prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Clear scanned items when hotel changes
  useEffect(() => {
    // Clear both temporary and confirmed scanned items when hotel changes
    setScannedTags(new Map());
    validatingEpcsRef.current.clear();
    setConfirmedScannedItems(new Map());
  }, [activeHotelId]);

  // Calculate tag counts by status
  const tagCounts = useMemo(() => {
    const counts = { valid: 0, wrong_hotel: 0, unregistered: 0, checking: 0, total: 0 };
    scannedTags.forEach(tag => {
      counts[tag.status]++;
      counts.total++;
    });
    return counts;
  }, [scannedTags]);

  // Total scanned items count for display
  const scannedItemsCount = confirmedScannedItems.size;

  // Check if there are any tags currently in range
  const hasTagsInRange = tagCounts.total > 0;

  // Check if there are problematic tags (wrong hotel or unregistered)
  const hasProblematicTags = tagCounts.wrong_hotel > 0 || tagCounts.unregistered > 0;

  // Count wrong hotel items in confirmed scanned items
  const confirmedWrongHotelCount = useMemo(() => {
    let count = 0;
    confirmedScannedItems.forEach(item => {
      if (item.status === 'wrong_hotel') count++;
    });
    return count;
  }, [confirmedScannedItems]);

  // Check if there are wrong hotel tags - BLOCKS printing (check both current and confirmed)
  const hasWrongHotelTags = tagCounts.wrong_hotel > 0 || confirmedWrongHotelCount > 0;

  // Check if items were scanned via RFID (skip confirmation for RFID scanned items)
  const hasRfidScannedItems = confirmedScannedItems.size > 0;

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
      // First mark items as ready for delivery (skip if no items)
      if (itemIds.length > 0) {
        await itemsApi.markClean(itemIds);
      }

      // Then create a delivery with the specified package count
      const delivery = await deliveriesApi.create({
        tenantId: hotelId,
        itemIds,
        packageCount: labelCount,
        notes: labelExtraData ? JSON.stringify(labelExtraData) : undefined,
      });

      // Get full delivery details for label generation
      const fullDelivery = await deliveriesApi.getById(delivery.id);

      // Generate and print labels with extra data
      generateDeliveryLabel(fullDelivery, labelExtraData);

      // Update status to label_printed
      try {
        await deliveriesApi.printLabel(delivery.id);
      } catch (printError) {
        // Continue anyway - label was generated
      }

      // Calculate total product count from labelExtraData
      const totalProducts = (labelExtraData || []).reduce((sum, item) => sum + (item.count || 0), 0);
      return { delivery: fullDelivery, labelCount, totalProducts };
    },
    onSuccess: (_, variables) => {
      toast.success('Urunler temizlendi ve etiket basildi!');
      // Counter now increments when packager scans the label
      queryClient.invalidateQueries({ queryKey: ['dirty-items'] });
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      refetchDirty();
      refetchPrinted();
      // Clear print list for the hotel
      if (variables.hotelId) {
        clearPrintList(variables.hotelId);
      }
      // Clear scanned items after printing
      setConfirmedScannedItems(new Map());
      setScannedTags(new Map());
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
  // Filter tenants by search - match from beginning of name only
  const filteredTenants = tenantsArray.filter((tenant: Tenant) =>
    hotelSearchFilter === '' || tenant.name.toLowerCase().startsWith(hotelSearchFilter.toLowerCase())
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
              <p className="text-lg font-semibold text-blue-600">by Karbeyaz & Demet Laundry</p>
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
              <p className="text-lg font-semibold text-blue-600">by Karbeyaz & Demet Laundry</p>
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

          {/* Right: RFID + Printer + Counter */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* RFID Reader Status */}
            {isElectron() && (
              <div className="flex items-center gap-2">
                {/* Connection Status with Settings Button */}
                <button
                  onClick={() => setShowRfidSettingsModal(true)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all hover:opacity-80 ${
                    uhfConnected
                      ? 'bg-green-50 border-green-300 text-green-700'
                      : 'bg-red-50 border-red-300 text-red-700'
                  }`}
                  title={uhfConnected ? `RFID Bağlı: ${rfidReaderIp}:${rfidReaderPort}` : 'RFID Okuyucu Bağlı Değil - Ayarlar için tıklayın'}
                >
                  {uhfConnected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                  <span className="text-xs font-medium">RFID</span>
                  <Settings className="w-3 h-3 opacity-60" />
                </button>

                {/* Connect and Scan Button */}
                <button
                  onClick={() => {
                    if (uhfConnected) {
                      // Disconnect
                      window.electronAPI?.uhfDisconnect();
                    } else {
                      // Connect (will auto-start scanning)
                      window.electronAPI?.uhfConnect();
                    }
                  }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-all ${
                    uhfConnected
                      ? hasProblematicTags
                        ? 'bg-red-500 border-red-600 text-white hover:bg-red-600 animate-pulse'
                        : 'bg-green-500 border-green-600 text-white hover:bg-green-600 animate-pulse'
                      : 'bg-blue-500 border-blue-600 text-white hover:bg-blue-600'
                  }`}
                  title={uhfConnected ? 'Bağlantıyı Kes' : 'Bağlan ve Tara'}
                >
                  {uhfConnected ? (
                    <>
                      <Radio className="w-4 h-4 animate-spin" />
                      <span className="text-sm font-medium">
                        Taranıyor {scannedItemsCount > 0 && `(${scannedItemsCount} ürün)`}
                      </span>
                    </>
                  ) : (
                    <>
                      <Wifi className="w-4 h-4" />
                      <span className="text-sm font-medium">Bağlan</span>
                    </>
                  )}
                </button>

                {/* Tag Counts - Show when scanning */}
                {uhfInventoryActive && tagCounts.total > 0 && (
                  <div className="flex items-center gap-1 px-2 py-1 bg-gray-100 rounded-lg border">
                    {tagCounts.valid > 0 && (
                      <span className="flex items-center gap-1 text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded" title="Geçerli">
                        <CheckCircle className="w-3 h-3" />
                        {tagCounts.valid}
                      </span>
                    )}
                    {tagCounts.wrong_hotel > 0 && (
                      <span className="flex items-center gap-1 text-xs text-orange-700 bg-orange-100 px-2 py-0.5 rounded" title="Yanlış Otel">
                        <AlertTriangle className="w-3 h-3" />
                        {tagCounts.wrong_hotel}
                      </span>
                    )}
                    {tagCounts.unregistered > 0 && (
                      <span className="flex items-center gap-1 text-xs text-red-700 bg-red-100 px-2 py-0.5 rounded" title="Tanımsız">
                        <XCircle className="w-3 h-3" />
                        {tagCounts.unregistered}
                      </span>
                    )}
                    {tagCounts.checking > 0 && (
                      <span className="flex items-center gap-1 text-xs text-gray-700 bg-gray-200 px-2 py-0.5 rounded" title="Kontrol Ediliyor">
                        <HelpCircle className="w-3 h-3 animate-pulse" />
                        {tagCounts.checking}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Printer Selection Button */}
            {isElectron() && (
              <button
                onClick={() => setShowPrinterModal(true)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-all ${
                  selectedPrinter
                    ? 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100'
                    : 'bg-red-50 border-red-300 text-red-700 hover:bg-red-100'
                }`}
                title="Yazıcı Seç"
              >
                <Settings className="w-5 h-5" />
                <span className="text-sm font-medium max-w-[120px] truncate">
                  {selectedPrinter || 'Yazıcı Seç'}
                </span>
              </button>
            )}

            {/* Counter */}
            <div className="flex items-center gap-4 bg-gray-900 text-white rounded-xl px-6 py-3">
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
        </div>

      {/* Hotel Selection Dialog */}
      {showHotelSelector && <HotelSelectionDialog />}

      {/* Printer Selection Modal */}
      {showPrinterModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Printer className="w-6 h-6 text-orange-600" />
                Yazıcı Seç
              </h2>
              <button
                onClick={() => setShowPrinterModal(false)}
                className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto">
              {availablePrinters.length === 0 ? (
                <p className="text-gray-500 text-center py-4">Yazıcı bulunamadı</p>
              ) : (
                availablePrinters.map((printer) => (
                  <button
                    key={printer.name}
                    onClick={() => {
                      setSelectedPrinter(printer.name);
                      savePreferredPrinter(printer.name);
                      setShowPrinterModal(false);
                      toast.success(`Yazıcı seçildi: ${printer.displayName}`);
                    }}
                    className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                      selectedPrinter === printer.name
                        ? 'bg-orange-50 border-orange-500 text-orange-700'
                        : 'bg-gray-50 border-gray-200 hover:border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{printer.displayName}</span>
                      {printer.isDefault && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Varsayılan</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{printer.name}</p>
                  </button>
                ))
              )}
            </div>

            <div className="mt-4 pt-4 border-t">
              <p className="text-xs text-gray-500 text-center">
                Seçilen yazıcı kaydedilecek ve etiketler bu yazıcıya gönderilecek
              </p>
            </div>
          </div>
        </div>
      )}

      {/* RFID Reader Settings Modal */}
      {showRfidSettingsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Radio className="w-6 h-6 text-blue-600" />
                RFID Okuyucu Ayarları
              </h2>
              <button
                onClick={() => {
                  setShowRfidSettingsModal(false);
                  setRfidScanProgress(null);
                }}
                className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Current Status */}
            <div className={`mb-4 p-4 rounded-lg border-2 ${uhfConnected ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {uhfConnected ? <Wifi className="w-5 h-5 text-green-600" /> : <WifiOff className="w-5 h-5 text-red-600" />}
                  <span className={`font-medium ${uhfConnected ? 'text-green-700' : 'text-red-700'}`}>
                    {uhfConnected ? 'Bağlı' : 'Bağlı Değil'}
                  </span>
                </div>
                {uhfConnected && (
                  <span className="text-sm text-green-600 font-mono">{rfidReaderIp}:{rfidReaderPort}</span>
                )}
              </div>
            </div>

            {/* Auto Scan Button */}
            <div className="mb-4">
              <button
                onClick={async () => {
                  setIsScanning(true);
                  setRfidScanProgress({ status: 'started', message: 'Ağ taraması başlatıldı...' });
                  try {
                    const result = await window.electronAPI?.uhfScanNetwork();
                    if (result?.success && result.ip && result.port) {
                      toast.success(`RFID Okuyucu bulundu: ${result.ip}:${result.port}`);
                      // Save to localStorage
                      localStorage.setItem('rfid_reader_ip', result.ip);
                      localStorage.setItem('rfid_reader_port', String(result.port));
                    } else {
                      toast.error('RFID Okuyucu bulunamadı');
                    }
                  } catch (err) {
                    toast.error('Tarama hatası');
                  }
                  setIsScanning(false);
                }}
                disabled={isScanning}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 font-medium transition-all"
              >
                {isScanning ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Taranıyor...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-5 h-5" />
                    Okuyucu Ara (Otomatik)
                  </>
                )}
              </button>
            </div>

            {/* Scan Progress */}
            {rfidScanProgress && (
              <div className={`mb-4 p-3 rounded-lg text-sm ${
                rfidScanProgress.status === 'found' ? 'bg-green-100 text-green-800' :
                rfidScanProgress.status === 'not_found' ? 'bg-red-100 text-red-800' :
                'bg-blue-100 text-blue-800'
              }`}>
                <div className="flex items-center gap-2">
                  {rfidScanProgress.status === 'found' ? (
                    <CheckCircle className="w-4 h-4" />
                  ) : rfidScanProgress.status === 'not_found' ? (
                    <XCircle className="w-4 h-4" />
                  ) : (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                  <span>{rfidScanProgress.message}</span>
                </div>
                {rfidScanProgress.ip && rfidScanProgress.port && (
                  <p className="mt-1 font-mono text-xs">{rfidScanProgress.ip}:{rfidScanProgress.port}</p>
                )}
              </div>
            )}

            {/* Manual IP Entry */}
            <div className="border-t pt-4 mt-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Manuel Bağlantı</p>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={manualIp}
                  onChange={(e) => setManualIp(e.target.value)}
                  placeholder="IP Adresi (örn: 192.168.1.100)"
                  className="flex-1 px-3 py-2 border-2 border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <input
                  type="text"
                  value={manualPort}
                  onChange={(e) => setManualPort(e.target.value)}
                  placeholder="Port"
                  className="w-20 px-3 py-2 border-2 border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <button
                onClick={async () => {
                  if (!manualIp) {
                    toast.warning('IP adresi girin');
                    return;
                  }
                  try {
                    // Save to localStorage
                    localStorage.setItem('rfid_reader_ip', manualIp);
                    localStorage.setItem('rfid_reader_port', manualPort);
                    // Connect
                    await window.electronAPI?.uhfSetConfig({ ip: manualIp, port: parseInt(manualPort) });
                    await window.electronAPI?.uhfConnect({ ip: manualIp, port: parseInt(manualPort) });
                    toast.success(`Bağlanılıyor: ${manualIp}:${manualPort}`);
                    setShowRfidSettingsModal(false);
                  } catch (err) {
                    toast.error('Bağlantı hatası');
                  }
                }}
                className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-medium"
              >
                Manuel Bağlan
              </button>
            </div>

            {/* Auto Connect on Found */}
            <div className="border-t pt-4 mt-4">
              <button
                onClick={async () => {
                  setIsScanning(true);
                  setRfidScanProgress({ status: 'started', message: 'Okuyucu aranıyor ve bağlanılıyor...' });
                  try {
                    const result = await window.electronAPI?.uhfAutoConnect();
                    if (result?.success && result.ip && result.port) {
                      toast.success(`Bağlandı: ${result.ip}:${result.port}`);
                      // Save to localStorage
                      localStorage.setItem('rfid_reader_ip', result.ip);
                      localStorage.setItem('rfid_reader_port', String(result.port));
                      setShowRfidSettingsModal(false);
                    } else {
                      toast.error('Okuyucu bulunamadı veya bağlanılamadı');
                    }
                  } catch (err) {
                    toast.error('Otomatik bağlantı hatası');
                  }
                  setIsScanning(false);
                }}
                disabled={isScanning}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-green-400 font-bold transition-all"
              >
                {isScanning ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Aranıyor...
                  </>
                ) : (
                  <>
                    <Wifi className="w-5 h-5" />
                    Otomatik Bul ve Bağlan
                  </>
                )}
              </button>
            </div>

            <div className="mt-4 pt-4 border-t">
              <p className="text-xs text-gray-500 text-center">
                Otomatik tarama, ağdaki BOHANG RFID okuyucuları protokol doğrulaması ile bulur
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Print Confirmation Modal - When tags are in range */}
      {showPrintConfirmModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-yellow-100 rounded-full">
                <AlertTriangle className="w-8 h-8 text-yellow-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Dikkat!</h2>
                <p className="text-gray-600">RFID tag'ler hala kapsama alanında</p>
              </div>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-yellow-800 mb-2">
                <strong>{tagCounts.total}</strong> adet tag hala anten alanında:
              </p>
              <div className="flex flex-wrap gap-2">
                {tagCounts.valid > 0 && (
                  <span className="flex items-center gap-1 text-sm text-green-700 bg-green-100 px-2 py-1 rounded">
                    <CheckCircle className="w-4 h-4" />
                    {tagCounts.valid} Doğru
                  </span>
                )}
                {tagCounts.wrong_hotel > 0 && (
                  <span className="flex items-center gap-1 text-sm text-orange-700 bg-orange-100 px-2 py-1 rounded">
                    <AlertTriangle className="w-4 h-4" />
                    {tagCounts.wrong_hotel} Yanlış Otel
                  </span>
                )}
                {tagCounts.unregistered > 0 && (
                  <span className="flex items-center gap-1 text-sm text-red-700 bg-red-100 px-2 py-1 rounded">
                    <XCircle className="w-4 h-4" />
                    {tagCounts.unregistered} Tanımsız
                  </span>
                )}
              </div>
            </div>

            {hasProblematicTags && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-red-800 font-medium">
                  Uyarı: Yanlış otel veya tanımsız tag'ler var! Bu ürünler yanlış etikete girebilir.
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowPrintConfirmModal(false);
                  setPendingPrintAction(null);
                }}
                className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
              >
                İptal
              </button>
              <button
                onClick={() => {
                  setShowPrintConfirmModal(false);
                  if (pendingPrintAction) {
                    pendingPrintAction();
                    setPendingPrintAction(null);
                  }
                }}
                className={`flex-1 px-4 py-3 rounded-lg font-medium ${
                  hasProblematicTags
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-orange-600 text-white hover:bg-orange-700'
                }`}
              >
                {hasProblematicTags ? 'Yine de Yazdır' : 'Onayla ve Yazdır'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unregistered Tags Warning - Show only for unregistered tags */}
      {activeHotelId && tagCounts.unregistered > 0 && (
        <div className="bg-gray-100 border-2 border-gray-300 rounded-xl p-3 mb-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1">
            <XCircle className="w-4 h-4" />
            Tanımsız Ürünler ({tagCounts.unregistered} adet) - Sisteme kayıtlı değil
          </h4>
        </div>
      )}

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

        // Group all scanned items by status and type
        const scannedItemsArray = Array.from(confirmedScannedItems.values());

        // Group valid items (correct hotel, needs label)
        const validItems = scannedItemsArray.filter(item => item.status === 'valid');
        const validGrouped = validItems.reduce((acc, item) => {
          const key = item.itemTypeId!;
          if (!acc[key]) {
            acc[key] = {
              itemType: item.itemType!,
              itemTypeId: item.itemTypeId!,
              count: 0
            };
          }
          acc[key].count++;
          return acc;
        }, {} as Record<string, { itemType: string; itemTypeId: string; count: number }>);
        const validList = Object.values(validGrouped);

        // Group wrong hotel items
        const wrongHotelItems = scannedItemsArray.filter(item => item.status === 'wrong_hotel');
        const wrongHotelGrouped = wrongHotelItems.reduce((acc, item) => {
          const key = `${item.hotelId}-${item.itemTypeId}`;
          if (!acc[key]) {
            acc[key] = {
              hotelId: item.hotelId!,
              hotelName: item.hotelName!,
              itemType: item.itemType!,
              itemTypeId: item.itemTypeId!,
              count: 0
            };
          }
          acc[key].count++;
          return acc;
        }, {} as Record<string, { hotelId: string; hotelName: string; itemType: string; itemTypeId: string; count: number }>);
        const wrongHotelList = Object.values(wrongHotelGrouped);

        const hasAnyScannedItems = validList.length > 0 || wrongHotelList.length > 0;
        const hasAnyItems = currentPrintList.length > 0 || hasAnyScannedItems;

        return (
          <div className="flex gap-6">
            {/* Left Panel: Print List (shown when items are added or wrong hotel items exist) */}
            {hasAnyItems && (
              <div className="w-72 flex-shrink-0">
                <div className={`bg-white rounded-xl shadow-lg border-2 overflow-hidden ${wrongHotelList.length > 0 ? 'border-red-300' : 'border-green-200'}`}>
                  <div className={`px-4 py-3 flex items-center justify-between ${wrongHotelList.length > 0 ? 'bg-gradient-to-r from-red-600 to-red-500' : 'bg-gradient-to-r from-green-600 to-green-500'}`}>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      {wrongHotelList.length > 0 && <AlertTriangle className="w-5 h-5" />}
                      Eklenenler
                    </h3>
                    <button
                      onClick={() => {
                        clearPrintList(hotelId);
                        setConfirmedScannedItems(new Map());
                      }}
                      className={`p-1 hover:bg-opacity-20 hover:bg-white rounded ${wrongHotelList.length > 0 ? 'text-red-100 hover:text-white' : 'text-green-100 hover:text-white'}`}
                      title="Listeyi temizle"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="p-3 space-y-2 max-h-96 overflow-y-auto">
                    {/* Wrong hotel items - shown with warning */}
                    {wrongHotelList.map((item, idx) => (
                      <div key={`wrong-${idx}`} className="flex items-center justify-between bg-red-50 rounded-lg p-3 border-2 border-red-300">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="font-bold text-red-800">{item.itemType}</p>
                            <p className="text-sm text-red-600">{item.count} adet</p>
                            <p className="text-xs text-red-500 font-medium">{item.hotelName}</p>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Valid scanned items - green (needs label) */}
                    {validList.map((item, idx) => (
                      <div key={`valid-${idx}`} className="flex items-center justify-between bg-green-50 rounded-lg p-3 border border-green-200">
                        <div className="flex items-start gap-2">
                          <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="font-bold text-gray-900">{item.itemType}</p>
                            <p className="text-sm text-green-700">{item.count} adet</p>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Manual items from print list (added via EKLE button) */}
                    {currentPrintList.map((item, idx) => (
                      <div key={`manual-${idx}`} className="flex items-center justify-between bg-green-50 rounded-lg p-3 border border-green-200">
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
                  <div className={`p-3 border-t ${wrongHotelList.length > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                    {wrongHotelList.length > 0 ? (
                      <p className="text-sm text-red-700 text-center font-medium">
                        Yanlış otel ürünlerini çıkarın!
                      </p>
                    ) : validList.length > 0 ? (
                      <p className="text-sm text-gray-600 text-center">
                        Yazdırılacak: <span className="font-bold text-green-700">{validList.reduce((sum, i) => sum + i.count, 0)}</span> adet
                      </p>
                    ) : (
                      <p className="text-sm text-gray-600 text-center">
                        Toplam: <span className="font-bold text-green-700">{currentPrintList.reduce((sum, i) => sum + i.count, 0)}</span> adet
                      </p>
                    )}
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
                            // Start with manual items from print list
                            let itemsToPrint = [...(printList[hotelId] || [])];

                            // Add RFID scanned valid items
                            validList.forEach(item => {
                              const existingIdx = itemsToPrint.findIndex(i => i.typeId === item.itemTypeId);
                              if (existingIdx >= 0) {
                                itemsToPrint[existingIdx] = {
                                  ...itemsToPrint[existingIdx],
                                  count: itemsToPrint[existingIdx].count + item.count,
                                };
                              } else {
                                itemsToPrint.push({
                                  typeId: item.itemTypeId,
                                  typeName: item.itemType,
                                  count: item.count,
                                  discardCount: 0,
                                  hasarliCount: 0
                                });
                              }
                            });

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

                            // Create the print action function
                            const executePrint = () => {
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
                            };

                            // If wrong hotel tags in range, block printing entirely
                            if (hasWrongHotelTags) {
                              toast.error('Yanlış otele ait ürünler kapsama alanında! Önce bu ürünleri çıkarın.');
                              return;
                            }

                            // If items were scanned via RFID, print directly without confirmation
                            // Otherwise, if there are tags in range, require confirmation
                            if (hasRfidScannedItems) {
                              // RFID scanned items - print directly
                              executePrint();
                            } else if (hasTagsInRange) {
                              // Manual entry but tags in range - ask confirmation
                              setPendingPrintAction(() => executePrint);
                              setShowPrintConfirmModal(true);
                            } else {
                              // No tags in range - print directly
                              executePrint();
                            }
                          }}
                          disabled={processAndPrintMutation.isPending || hasWrongHotelTags}
                          className={`h-14 px-6 flex items-center justify-center gap-2 rounded-xl font-bold text-lg transition-all shadow-lg ${
                            hasWrongHotelTags
                              ? 'bg-gradient-to-b from-gray-400 to-gray-500 text-white cursor-not-allowed'
                              : hasProblematicTags
                                ? 'bg-gradient-to-b from-red-500 to-red-600 text-white hover:from-red-600 hover:to-red-700'
                                : 'bg-gradient-to-b from-orange-500 to-orange-600 text-white hover:from-orange-600 hover:to-orange-700'
                          } disabled:cursor-not-allowed`}
                        >
                          {hasWrongHotelTags && <XCircle className="w-5 h-5" />}
                          {!hasWrongHotelTags && hasProblematicTags && <AlertTriangle className="w-5 h-5" />}
                          <Printer className="w-5 h-5" />
                          {processAndPrintMutation.isPending ? 'Yazdiriliyor...' : hasWrongHotelTags ? 'YANLIŞ OTEL VAR!' : 'YAZDIR'}
                        </button>
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
