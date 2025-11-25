import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Building2, Package, CheckCircle, RefreshCw, Truck, Scan, X, Radio, Square, History } from 'lucide-react';
import { pickupsApi, settingsApi, getErrorMessage } from '../../lib/api';
import { useToast } from '../../components/Toast';
import type { Tenant } from '../../types';

interface ScannedItem {
  rfidTag: string;
  itemType: string;
  scannedAt: Date;
}

// Mock RFID data - simulates items that could be scanned
const MOCK_RFID_ITEMS = [
  { prefix: 'RFID-BS', type: 'Bed Sheet' },
  { prefix: 'RFID-TW', type: 'Towel' },
  { prefix: 'RFID-PC', type: 'Pillow Case' },
  { prefix: 'RFID-BM', type: 'Bath Mat' },
  { prefix: 'RFID-DC', type: 'Duvet Cover' },
  { prefix: 'RFID-BR', type: 'Bathrobe' },
  { prefix: 'RFID-HT', type: 'Hand Towel' },
  { prefix: 'RFID-BL', type: 'Blanket' },
  { prefix: 'RFID-TC', type: 'Table Cloth' },
  { prefix: 'RFID-NP', type: 'Napkin' },
];

export function DirtyPickupPage() {
  const [selectedHotel, setSelectedHotel] = useState<string | null>(null);
  const [pickupMode, setPickupMode] = useState<'select' | 'quick' | 'rfid'>('select');
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [rfidInput, setRfidInput] = useState('');
  const [autoScanActive, setAutoScanActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const scannedTagsRef = useRef<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: tenants, isLoading: loadingTenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: settingsApi.getTenants,
  });

  // Get today's received pickups (for history display)
  const { data: todayPickups, refetch } = useQuery({
    queryKey: ['pickups', { status: 'received' }],
    queryFn: () => pickupsApi.getAll({ status: 'received', limit: 20 }),
  });

  const createPickupMutation = useMutation({
    mutationFn: pickupsApi.create,
    onSuccess: () => {
      toast.success('Pickup confirmed and delivered to laundry!');
      queryClient.invalidateQueries({ queryKey: ['pickups'] });
      resetForm();
      refetch();
    },
    onError: (err) => toast.error('Failed to create pickup', getErrorMessage(err)),
  });

  const resetForm = () => {
    setSelectedHotel(null);
    setPickupMode('select');
    setScannedItems([]);
    setIsScanning(false);
    setRfidInput('');
    setAutoScanActive(false);
    scannedTagsRef.current.clear();
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
  };

  // Generate a unique mock RFID tag
  const generateMockRfidTag = useCallback(() => {
    const item = MOCK_RFID_ITEMS[Math.floor(Math.random() * MOCK_RFID_ITEMS.length)];
    const uniqueId = Math.random().toString(36).substring(2, 8).toUpperCase();
    return {
      rfidTag: `${item.prefix}-${uniqueId}`,
      itemType: item.type,
    };
  }, []);

  // Mock RFID auto-scan effect
  useEffect(() => {
    if (autoScanActive && pickupMode === 'rfid') {
      // Simulate scanning items at random intervals (0.3-1.5 seconds)
      const scheduleNextScan = () => {
        const delay = 300 + Math.random() * 1200;
        scanIntervalRef.current = setTimeout(() => {
          const { rfidTag, itemType } = generateMockRfidTag();

          // Check for duplicates
          if (!scannedTagsRef.current.has(rfidTag)) {
            scannedTagsRef.current.add(rfidTag);
            setScannedItems(prev => [
              { rfidTag, itemType, scannedAt: new Date() },
              ...prev,
            ]);
          }

          if (autoScanActive) {
            scheduleNextScan();
          }
        }, delay);
      };

      scheduleNextScan();

      return () => {
        if (scanIntervalRef.current) {
          clearTimeout(scanIntervalRef.current);
          scanIntervalRef.current = null;
        }
      };
    }
  }, [autoScanActive, pickupMode, generateMockRfidTag]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (scanIntervalRef.current) {
        clearTimeout(scanIntervalRef.current);
      }
    };
  }, []);

  // Auto-focus input when scanning manually
  useEffect(() => {
    if (isScanning && !autoScanActive && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isScanning, autoScanActive]);

  const handleQuickPickup = () => {
    if (!selectedHotel) return;

    const bagCode = `PKP-${Date.now().toString(36).toUpperCase()}`;
    createPickupMutation.mutate({
      tenantId: selectedHotel,
      bagCode,
      itemIds: [],
    });
  };

  const handleRfidPickup = () => {
    if (!selectedHotel || scannedItems.length === 0) return;

    // Stop auto-scan if active
    setAutoScanActive(false);

    const bagCode = `PKP-${Date.now().toString(36).toUpperCase()}`;

    // Group items by type for notes
    const itemCounts = scannedItems.reduce((acc, item) => {
      acc[item.itemType] = (acc[item.itemType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const notes = `RFID Scanned (${scannedItems.length} items): ` + Object.entries(itemCounts)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ');

    // Don't send itemIds since they're mock RFID tags, not real item UUIDs
    // The scanned item info is stored in notes
    createPickupMutation.mutate({
      tenantId: selectedHotel,
      bagCode,
      notes,
    });
  };

  const handleManualScan = () => {
    if (!rfidInput.trim()) return;

    const tag = rfidInput.trim().toUpperCase();

    // Check for duplicates
    if (scannedTagsRef.current.has(tag)) {
      toast.warning('Item already scanned!');
      setRfidInput('');
      return;
    }

    // Determine item type from prefix or assign random
    let itemType = 'Unknown Item';
    for (const item of MOCK_RFID_ITEMS) {
      if (tag.startsWith(item.prefix)) {
        itemType = item.type;
        break;
      }
    }
    if (itemType === 'Unknown Item') {
      itemType = MOCK_RFID_ITEMS[Math.floor(Math.random() * MOCK_RFID_ITEMS.length)].type;
    }

    scannedTagsRef.current.add(tag);
    setScannedItems(prev => [
      { rfidTag: tag, itemType, scannedAt: new Date() },
      ...prev,
    ]);

    setRfidInput('');
    toast.success(`Scanned: ${itemType}`);
  };

  const removeScannedItem = (rfidTag: string) => {
    scannedTagsRef.current.delete(rfidTag);
    setScannedItems(prev => prev.filter(item => item.rfidTag !== rfidTag));
  };

  const toggleAutoScan = () => {
    setAutoScanActive(prev => !prev);
    if (!autoScanActive) {
      toast.info('Auto-scan started - simulating RFID reader');
    } else {
      toast.info('Auto-scan stopped');
    }
  };

  const selectedTenant = tenants?.find((t: Tenant) => t.id === selectedHotel);
  const recentPickups = todayPickups?.data || [];

  // Group scanned items by type
  const itemsByType = scannedItems.reduce((acc, item) => {
    acc[item.itemType] = (acc[item.itemType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 animate-fade-in min-h-screen bg-gray-50">
      {/* Header */}
      <div className="flex items-center gap-3 md:gap-4">
        <div className="p-3 md:p-4 bg-orange-100 rounded-xl">
          <ArrowUp className="w-8 h-8 md:w-10 md:h-10 text-orange-600" />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Dirty Pickup</h1>
          <p className="text-sm md:text-base text-gray-500">Collect dirty laundry from hotels</p>
        </div>
      </div>

      {/* Create New Pickup */}
      <div className="bg-white rounded-2xl shadow-lg p-4 md:p-6">
        <h2 className="text-lg md:text-xl font-bold text-gray-900 mb-4 md:mb-6 flex items-center gap-2">
          <Package className="w-5 h-5 md:w-6 md:h-6 text-orange-500" />
          New Dirty Pickup
        </h2>

        {/* Step 1: Hotel Selection */}
        {!selectedHotel && (
          <div>
            <label className="block text-base md:text-lg font-semibold text-gray-700 mb-3">
              Select Hotel
            </label>
            {loadingTenants ? (
              <div className="flex justify-center py-8">
                <RefreshCw className="w-8 h-8 animate-spin text-orange-500" />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {tenants?.map((tenant: Tenant) => (
                  <button
                    key={tenant.id}
                    onClick={() => setSelectedHotel(tenant.id)}
                    className="p-4 rounded-xl border-2 border-gray-200 text-left transition-all active:scale-[0.98] hover:border-orange-300 hover:bg-orange-50"
                  >
                    <Building2 className="w-8 h-8 mb-2 text-gray-400" />
                    <p className="font-bold text-gray-900 truncate">{tenant.name}</p>
                    <p className="text-xs text-gray-500 truncate">{tenant.address}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Choose Pickup Mode */}
        {selectedHotel && pickupMode === 'select' && (
          <div className="space-y-4">
            {/* Selected Hotel */}
            <div className="bg-orange-50 rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Building2 className="w-8 h-8 text-orange-600" />
                <div>
                  <p className="font-bold text-gray-900">{selectedTenant?.name}</p>
                  <p className="text-xs text-gray-500">{selectedTenant?.address}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedHotel(null)}
                className="p-2 text-gray-500 hover:bg-orange-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode Selection */}
            <p className="text-center text-gray-600 font-medium">How do you want to pickup?</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Quick Pickup */}
              <button
                onClick={() => setPickupMode('quick')}
                className="p-6 rounded-xl border-2 border-gray-200 hover:border-orange-400 hover:bg-orange-50 transition-all active:scale-[0.98] text-left"
              >
                <Truck className="w-12 h-12 text-orange-500 mb-3" />
                <h3 className="text-lg font-bold text-gray-900">Quick Pickup</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Just confirm pickup. Laundry staff will count items later.
                </p>
              </button>

              {/* RFID Scan */}
              <button
                onClick={() => {
                  setPickupMode('rfid');
                  setIsScanning(true);
                }}
                className="p-6 rounded-xl border-2 border-gray-200 hover:border-green-400 hover:bg-green-50 transition-all active:scale-[0.98] text-left"
              >
                <Scan className="w-12 h-12 text-green-500 mb-3" />
                <h3 className="text-lg font-bold text-gray-900">RFID Scan</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Scan items with RFID reader for automatic counting.
                </p>
              </button>
            </div>
          </div>
        )}

        {/* Quick Pickup Confirmation */}
        {selectedHotel && pickupMode === 'quick' && (
          <div className="space-y-4">
            <div className="bg-orange-50 rounded-xl p-4 md:p-6">
              <div className="flex items-center gap-3 md:gap-4">
                <Truck className="w-10 h-10 md:w-12 md:h-12 text-orange-600 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm md:text-lg font-bold text-gray-900">Quick pickup from:</p>
                  <p className="text-xl md:text-2xl font-bold text-orange-600 truncate">{selectedTenant?.name}</p>
                </div>
              </div>
            </div>

            <p className="text-sm text-gray-500 text-center">
              Item counts will be entered by laundry staff upon delivery
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setPickupMode('select')}
                className="flex-1 py-4 bg-gray-100 text-gray-700 rounded-xl text-lg font-bold hover:bg-gray-200 active:bg-gray-300 touch-manipulation"
              >
                Back
              </button>
              <button
                onClick={handleQuickPickup}
                disabled={createPickupMutation.isPending}
                className="flex-1 py-4 bg-orange-600 text-white rounded-xl text-lg font-bold hover:bg-orange-700 active:bg-orange-800 disabled:bg-gray-400 flex items-center justify-center gap-2 touch-manipulation"
              >
                <CheckCircle className="w-6 h-6" />
                {createPickupMutation.isPending ? 'Creating...' : 'Confirm'}
              </button>
            </div>
          </div>
        )}

        {/* RFID Scanning Mode */}
        {selectedHotel && pickupMode === 'rfid' && (
          <div className="space-y-4">
            {/* Hotel & Auto-Scan Toggle */}
            <div className="bg-green-50 rounded-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Building2 className="w-8 h-8 text-green-600" />
                  <div>
                    <p className="font-bold text-gray-900">{selectedTenant?.name}</p>
                    <p className="text-xs text-gray-500">{scannedItems.length} items scanned</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setAutoScanActive(false);
                    setPickupMode('select');
                    setScannedItems([]);
                    setIsScanning(false);
                    scannedTagsRef.current.clear();
                  }}
                  className="p-2 text-gray-500 hover:bg-green-100 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Auto-Scan Button */}
              <button
                onClick={toggleAutoScan}
                className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all touch-manipulation ${
                  autoScanActive
                    ? 'bg-red-500 text-white hover:bg-red-600 active:bg-red-700'
                    : 'bg-green-600 text-white hover:bg-green-700 active:bg-green-800'
                }`}
              >
                {autoScanActive ? (
                  <>
                    <Square className="w-6 h-6" />
                    Stop Scanning
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
                    </span>
                  </>
                ) : (
                  <>
                    <Radio className="w-6 h-6" />
                    Start RFID Scanning
                  </>
                )}
              </button>

              {/* Scanning Animation */}
              {autoScanActive && (
                <div className="mt-4 flex items-center justify-center gap-2 text-green-700">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                  <span className="text-sm font-medium">Scanning for RFID tags...</span>
                </div>
              )}

              {/* Manual Input (shown when not auto-scanning) */}
              {!autoScanActive && (
                <div className="mt-4">
                  <p className="text-xs text-gray-500 mb-2 text-center">Or enter RFID tag manually:</p>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Scan className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-green-500" />
                      <input
                        ref={inputRef}
                        type="text"
                        value={rfidInput}
                        onChange={(e) => setRfidInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleManualScan()}
                        placeholder="Enter RFID tag..."
                        className="w-full pl-10 pr-4 py-3 border-2 border-green-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500 text-lg"
                      />
                    </div>
                    <button
                      onClick={handleManualScan}
                      className="px-4 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 active:bg-green-800 touch-manipulation"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Scanned Items Summary */}
            {scannedItems.length > 0 && (
              <div className="bg-white border-2 border-green-200 rounded-xl p-4">
                <h3 className="font-bold text-gray-900 mb-3 flex items-center justify-between">
                  <span>Scanned Items</span>
                  <span className="text-green-600 text-2xl">{scannedItems.length}</span>
                </h3>

                {/* Items by Type Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                  {Object.entries(itemsByType).map(([type, count]) => (
                    <div key={type} className="bg-green-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-green-600">{count}</p>
                      <p className="text-xs text-gray-600 truncate">{type}</p>
                    </div>
                  ))}
                </div>

                {/* Recent Scans List */}
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {scannedItems.slice(0, 15).map((item, index) => (
                    <div
                      key={item.rfidTag}
                      className={`flex items-center justify-between py-2 px-3 rounded-lg text-sm ${
                        index === 0 ? 'bg-green-100 animate-pulse' : 'bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-gray-500 text-xs truncate">{item.rfidTag}</span>
                        <span className="text-gray-900 font-medium">{item.itemType}</span>
                      </div>
                      <button
                        onClick={() => removeScannedItem(item.rfidTag)}
                        className="p-1 text-red-500 hover:bg-red-50 rounded flex-shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {scannedItems.length > 15 && (
                    <p className="text-center text-xs text-gray-400 py-2">
                      +{scannedItems.length - 15} more items
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setAutoScanActive(false);
                  setPickupMode('select');
                  setScannedItems([]);
                  setIsScanning(false);
                  scannedTagsRef.current.clear();
                }}
                className="flex-1 py-4 bg-gray-100 text-gray-700 rounded-xl text-lg font-bold hover:bg-gray-200 active:bg-gray-300 touch-manipulation"
              >
                Cancel
              </button>
              <button
                onClick={handleRfidPickup}
                disabled={createPickupMutation.isPending || scannedItems.length === 0}
                className="flex-1 py-4 bg-green-600 text-white rounded-xl text-lg font-bold hover:bg-green-700 active:bg-green-800 disabled:bg-gray-400 flex items-center justify-center gap-2 touch-manipulation"
              >
                <CheckCircle className="w-6 h-6" />
                {createPickupMutation.isPending ? 'Creating...' : `Confirm (${scannedItems.length})`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Recent Pickups - History */}
      <div className="bg-white rounded-2xl shadow-lg p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg md:text-xl font-bold text-gray-900 flex items-center gap-2">
            <History className="w-5 h-5 md:w-6 md:h-6 text-green-500" />
            Recent Deliveries ({recentPickups.length})
          </h2>
          <button
            onClick={() => refetch()}
            className="p-2 text-gray-500 hover:bg-gray-100 active:bg-gray-200 rounded-lg touch-manipulation"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>

        {recentPickups.length === 0 ? (
          <div className="text-center py-8 md:py-12 text-gray-500">
            <Package className="w-12 h-12 md:w-16 md:h-16 mx-auto text-gray-300 mb-4" />
            <p className="text-lg md:text-xl">No recent deliveries</p>
            <p className="text-sm text-gray-400 mt-1">Pickups you create will appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentPickups.map((pickup: any) => (
              <div
                key={pickup.id}
                className="flex items-center justify-between p-3 md:p-4 rounded-xl border-2 bg-green-50 border-green-200"
              >
                <div className="flex items-center gap-3 md:gap-4 min-w-0">
                  <CheckCircle className="w-8 h-8 md:w-10 md:h-10 text-green-600 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="font-bold text-base md:text-lg text-gray-900 truncate">{pickup.tenant?.name}</p>
                    <p className="text-xs md:text-sm text-gray-500 truncate">
                      {pickup.notes || 'Quick pickup'}
                    </p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  <span className="px-2 md:px-3 py-1 rounded-full text-xs md:text-sm font-medium bg-green-100 text-green-800">
                    Delivered
                  </span>
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(pickup.receivedDate || pickup.createdAt).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
