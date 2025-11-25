import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, Package, CheckCircle, RefreshCw, QrCode, MapPin, Clock, Plus, X, Tag } from 'lucide-react';
import { deliveriesApi, pickupsApi, settingsApi, itemsApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import type { Delivery } from '../types';

type TabType = 'dirty-pickup' | 'clean-pickup' | 'deliver';

export function DriverActivitiesPage() {
  const [activeTab, setActiveTab] = useState<TabType>('dirty-pickup');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scannedDelivery, setScannedDelivery] = useState<Delivery | null>(null);

  // Dirty pickup form state
  const [tenantId, setTenantId] = useState('');
  const [bagCode, setBagCode] = useState('');
  const [sealNumber, setSealNumber] = useState('');
  const [rfidInput, setRfidInput] = useState('');
  const [scannedItems, setScannedItems] = useState<any[]>([]);
  const [notes, setNotes] = useState('');

  // Manual item count state
  const [selectedItemTypeId, setSelectedItemTypeId] = useState('');
  const [itemQuantity, setItemQuantity] = useState('1');
  const [manualItems, setManualItems] = useState<any[]>([]);

  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: settingsApi.getTenants,
  });

  const { data: itemTypes } = useQuery({
    queryKey: ['itemTypes'],
    queryFn: settingsApi.getItemTypes,
  });

  // Deliveries ready for pickup (packaged)
  const { data: packagedDeliveries, isLoading: loadingPackaged, refetch: refetchPackaged } = useQuery({
    queryKey: ['deliveries', { status: 'packaged' }],
    queryFn: () => deliveriesApi.getAll({ status: 'packaged', limit: 50 }),
  });

  // Deliveries in transit (picked up, ready to deliver)
  const { data: inTransitDeliveries, isLoading: loadingInTransit, refetch: refetchInTransit } = useQuery({
    queryKey: ['deliveries', { status: 'picked_up' }],
    queryFn: () => deliveriesApi.getAll({ status: 'picked_up', limit: 50 }),
  });

  // Recent pickups
  const { data: recentPickups } = useQuery({
    queryKey: ['pickups', { limit: 5 }],
    queryFn: () => pickupsApi.getAll({ limit: 5 }),
  });

  // Scan items for dirty pickup
  const scanItemsMutation = useMutation({
    mutationFn: (rfidTags: string[]) => itemsApi.scan(rfidTags),
    onSuccess: (data) => {
      if (data.items.length > 0) {
        const newItems = data.items.filter(
          item => !scannedItems.find(s => s.id === item.id)
        );
        if (newItems.length > 0) {
          setScannedItems([...scannedItems, ...newItems]);
          toast.success(`${newItems.length} ürün eklendi`);
        } else {
          toast.warning('Ürün zaten tarandı');
        }
      }
      if (data.notFound > 0) {
        toast.warning(`${data.notFound} etiket sistemde bulunamadı`);
      }
      setRfidInput('');
    },
    onError: (err) => toast.error('Tarama başarısız', getErrorMessage(err)),
  });

  // Create items manually (without RFID scanning)
  const createItemsMutation = useMutation({
    mutationFn: async ({
      itemTypeId,
      quantity,
      tenantId,
    }: {
      itemTypeId: string;
      quantity: number;
      tenantId: string;
    }) => {
      // Create individual items for each count
      const promises = Array.from({ length: quantity }, (_, index) => {
        const timestamp = Date.now();
        const tempRfidTag = `TEMP-${timestamp}-${index}-${Math.random().toString(36).substring(2, 8)}`;
        return itemsApi.create({
          rfidTag: tempRfidTag,
          itemTypeId,
          tenantId,
          status: 'at_hotel',
        });
      });
      return Promise.all(promises);
    },
    onSuccess: (createdItems) => {
      setManualItems([...manualItems, ...createdItems]);
      toast.success(`${createdItems.length} ürün eklendi`);
      setSelectedItemTypeId('');
      setItemQuantity('1');
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
    onError: (err) => toast.error('Ürün oluşturulamadı', getErrorMessage(err)),
  });

  // Create dirty pickup
  const createPickupMutation = useMutation({
    mutationFn: pickupsApi.create,
    onSuccess: () => {
      toast.success('Kirli toplama başarıyla oluşturuldu!');
      queryClient.invalidateQueries({ queryKey: ['pickups'] });
      // Reset form
      setTenantId('');
      setBagCode('');
      setSealNumber('');
      setScannedItems([]);
      setManualItems([]);
      setNotes('');
    },
    onError: (err) => toast.error('Toplama oluşturulamadı', getErrorMessage(err)),
  });

  const scanMutation = useMutation({
    mutationFn: (barcode: string) => deliveriesApi.getByBarcode(barcode),
    onSuccess: (delivery) => {
      if (activeTab === 'clean-pickup' && delivery.status === 'packaged') {
        setScannedDelivery(delivery);
        toast.success('Toplama için hazır!');
      } else if (activeTab === 'deliver' && delivery.status === 'picked_up') {
        setScannedDelivery(delivery);
        toast.success('Teslimat için hazır!');
      } else {
        toast.warning(`${activeTab === 'clean-pickup' ? 'Toplama' : 'Teslimat'} yapılamaz - teslimat durumu "${delivery.status}"`);
      }
      setBarcodeInput('');
    },
    onError: (err) => {
      toast.error('Teslimat bulunamadı', getErrorMessage(err));
      setBarcodeInput('');
    },
  });

  const pickupMutation = useMutation({
    mutationFn: deliveriesApi.pickup,
    onSuccess: () => {
      toast.success('Teslimat toplandı!');
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      setScannedDelivery(null);
    },
    onError: (err) => toast.error('Toplama başarısız', getErrorMessage(err)),
  });

  const deliverMutation = useMutation({
    mutationFn: deliveriesApi.deliver,
    onSuccess: () => {
      toast.success('Teslimat tamamlandı!');
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      setScannedDelivery(null);
    },
    onError: (err) => toast.error('Teslimat başarısız', getErrorMessage(err)),
  });

  const handleScanBarcode = () => {
    if (!barcodeInput.trim()) return;
    scanMutation.mutate(barcodeInput.trim());
  };

  const handleScanItems = () => {
    if (!rfidInput.trim()) return;
    const tags = rfidInput.split(/[,\s]+/).filter(t => t.trim());
    if (tags.length > 0) {
      scanItemsMutation.mutate(tags);
    }
  };

  const handleRemoveItem = (itemId: string) => {
    setScannedItems(scannedItems.filter(item => item.id !== itemId));
  };

  const handleRemoveManualItem = (itemId: string) => {
    setManualItems(manualItems.filter(item => item.id !== itemId));
  };

  const handleAddManualItems = () => {
    if (!selectedItemTypeId || !tenantId) {
      toast.warning('Lütfen otel ve ürün tipi seçin');
      return;
    }
    const quantity = parseInt(itemQuantity);
    if (isNaN(quantity) || quantity < 1) {
      toast.warning('Lütfen geçerli bir miktar girin (minimum 1)');
      return;
    }
    createItemsMutation.mutate({
      itemTypeId: selectedItemTypeId,
      quantity,
      tenantId,
    });
  };

  const handleCreateDirtyPickup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !bagCode || !sealNumber) {
      toast.warning('Lütfen tüm zorunlu alanları doldurun');
      return;
    }
    // Combine both scanned and manual items
    const allItemIds = [
      ...scannedItems.map(item => item.id),
      ...manualItems.map(item => item.id),
    ];
    if (allItemIds.length === 0) {
      toast.warning('Lütfen en az bir ürün ekleyin (RFID tarayın veya manuel ekleyin)');
      return;
    }
    createPickupMutation.mutate({
      tenantId,
      bagCode,
      sealNumber,
      itemIds: allItemIds,
      notes: notes || undefined,
    });
  };

  const generateBagCode = () => {
    const code = `BAG-${Date.now().toString(36).toUpperCase()}`;
    setBagCode(code);
  };

  const generateSealNumber = () => {
    const seal = `SEAL-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    setSealNumber(seal);
  };

  const handleRefresh = () => {
    refetchPackaged();
    refetchInTransit();
  };

  const packaged = packagedDeliveries?.data || [];
  const inTransit = inTransitDeliveries?.data || [];
  const recentPickupsList = recentPickups?.data || [];

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-cyan-100 rounded-lg">
            <Truck className="w-8 h-8 text-cyan-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Surucu Aktiviteleri</h1>
            <p className="text-gray-500">Kirli toplama ve temiz teslimatlar</p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
        >
          <RefreshCw className="w-4 h-4" />
          Yenile
        </button>
      </div>

      {/* Tab Selector */}
      <div className="bg-white rounded-lg shadow p-1 inline-flex gap-1">
        <button
          onClick={() => { setActiveTab('dirty-pickup'); setScannedDelivery(null); }}
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'dirty-pickup'
              ? 'bg-orange-600 text-white'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Kirli Toplama (Otel → Camasir)
        </button>
        <button
          onClick={() => { setActiveTab('clean-pickup'); setScannedDelivery(null); }}
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'clean-pickup'
              ? 'bg-cyan-600 text-white'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Temiz Toplama (Camasir → Arac)
        </button>
        <button
          onClick={() => { setActiveTab('deliver'); setScannedDelivery(null); }}
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'deliver'
              ? 'bg-green-600 text-white'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Teslimat (Arac → Otel)
        </button>
      </div>

      {/* Dirty Pickup Tab */}
      {activeTab === 'dirty-pickup' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <form onSubmit={handleCreateDirtyPickup} className="bg-white rounded-lg shadow p-6 space-y-6">
              <h2 className="text-lg font-semibold border-b pb-2">Otelden Kirli Toplama</h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Otel <span className="text-red-500">*</span>
                </label>
                <select
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                  required
                >
                  <option value="">Otel secin...</option>
                  {tenants?.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Torba Kodu <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={bagCode}
                      onChange={(e) => setBagCode(e.target.value)}
                      className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                      placeholder="BAG-XXXXX"
                      required
                    />
                    <button
                      type="button"
                      onClick={generateBagCode}
                      className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                    >
                      <QrCode className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Mühür Numarası <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={sealNumber}
                      onChange={(e) => setSealNumber(e.target.value)}
                      className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                      placeholder="SEAL-XXXXX"
                      required
                    />
                    <button
                      type="button"
                      onClick={generateSealNumber}
                      className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                    >
                      <QrCode className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  RFID Etiketlerini Tara (opsiyonel)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={rfidInput}
                    onChange={(e) => setRfidInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleScanItems())}
                    className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                    placeholder="RFID etiketi girin veya tarayin..."
                  />
                  <button
                    type="button"
                    onClick={handleScanItems}
                    disabled={scanItemsMutation.isPending}
                    className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
                  >
                    {scanItemsMutation.isPending ? 'Taranıyor...' : 'Ekle'}
                  </button>
                </div>
              </div>

              <div className="border-t pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Veya Sayıyla Ürün Ekle
                </label>
                <div className="grid grid-cols-[1fr,auto,auto] gap-2">
                  <select
                    value={selectedItemTypeId}
                    onChange={(e) => setSelectedItemTypeId(e.target.value)}
                    className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                    disabled={!tenantId}
                  >
                    <option value="">Ürün tipi secin...</option>
                    {itemTypes?.map(type => (
                      <option key={type.id} value={type.id}>{type.name}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    value={itemQuantity}
                    onChange={(e) => setItemQuantity(e.target.value)}
                    className="w-24 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                    placeholder="Adet"
                    disabled={!tenantId}
                  />
                  <button
                    type="button"
                    onClick={handleAddManualItems}
                    disabled={createItemsMutation.isPending || !tenantId}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    {createItemsMutation.isPending ? 'Ekleniyor...' : 'Ekle'}
                  </button>
                </div>
                {!tenantId && (
                  <p className="text-xs text-gray-500 mt-1">Sayıyla ürün eklemek için önce bir otel secin</p>
                )}
              </div>

              {(scannedItems.length > 0 || manualItems.length > 0) && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Tüm Ürünler ({scannedItems.length + manualItems.length})
                    </label>
                    <span className="text-xs text-gray-500">1 torba</span>
                  </div>
                  <div className="border rounded-lg max-h-64 overflow-y-auto">
                    {scannedItems.length > 0 && (
                      <>
                        <div className="px-2 py-1 bg-gray-100 border-b">
                          <span className="text-xs font-medium text-gray-600">RFID ile Taranan ({scannedItems.length})</span>
                        </div>
                        {scannedItems.map(item => (
                          <div key={item.id} className="flex items-center justify-between p-2 border-b last:border-b-0 hover:bg-gray-50">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-sm">{item.rfidTag}</span>
                                <span className="text-sm text-gray-500">{item.itemType?.name}</span>
                              </div>
                              <div className="flex items-center gap-3 mt-1">
                                <span className="text-xs text-gray-400">
                                  Yıkama sayısı: {item.washCount || 0}
                                </span>
                                <span className={`text-xs px-1.5 py-0.5 rounded ${
                                  item.status === 'at_hotel' ? 'bg-blue-100 text-blue-700' :
                                  item.status === 'at_laundry' ? 'bg-purple-100 text-purple-700' :
                                  'bg-gray-100 text-gray-700'
                                }`}>
                                  {item.status}
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(item.id)}
                              className="p-1 text-red-500 hover:bg-red-50 rounded ml-2"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </>
                    )}
                    {manualItems.length > 0 && (
                      <>
                        <div className="px-2 py-1 bg-green-50 border-b">
                          <span className="text-xs font-medium text-green-700">Manuel Eklenen ({manualItems.length})</span>
                        </div>
                        {manualItems.map(item => (
                          <div key={item.id} className="flex items-center justify-between p-2 border-b last:border-b-0 hover:bg-gray-50">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs text-gray-400">{item.rfidTag}</span>
                                <span className="text-sm font-medium text-gray-700">{item.itemType?.name}</span>
                              </div>
                              <div className="flex items-center gap-3 mt-1">
                                <span className="text-xs text-gray-400">
                                  Yıkama sayısı: {item.washCount || 0}
                                </span>
                                <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                                  {item.status}
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveManualItem(item.id)}
                              className="p-1 text-red-500 hover:bg-red-50 rounded ml-2"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notlar (opsiyonel)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                  placeholder="Ozel notlar..."
                />
              </div>

              <button
                type="submit"
                disabled={createPickupMutation.isPending}
                className="w-full py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 flex items-center justify-center gap-2 font-medium"
              >
                {createPickupMutation.isPending ? 'Oluşturuluyor...' : (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    Kirli Toplama Oluştur
                  </>
                )}
              </button>
            </form>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Son Toplamalar</h2>
            {recentPickupsList.length === 0 ? (
              <p className="text-gray-500 text-center py-4">Son toplama yok</p>
            ) : (
              <div className="space-y-3">
                {recentPickupsList.map(pickup => {
                  const itemCount = pickup.pickupItems?.length || 0;
                  return (
                    <div key={pickup.id} className="p-3 border rounded-lg hover:shadow-sm transition-shadow">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono font-medium text-sm">{pickup.bagCode}</span>
                        <span className={`px-2 py-0.5 text-xs rounded-full ${
                          pickup.status === 'created' ? 'bg-yellow-100 text-yellow-800' :
                          pickup.status === 'received' ? 'bg-blue-100 text-blue-800' :
                          'bg-green-100 text-green-800'
                        }`}>
                          {pickup.status === 'created' ? 'Oluşturuldu' : pickup.status === 'received' ? 'Alındı' : pickup.status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-1">{pickup.tenant?.name}</p>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Package className="w-3 h-3" />
                          1 torba
                        </span>
                        <span className="flex items-center gap-1">
                          <Tag className="w-3 h-3" />
                          {itemCount} ürün
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-2">
                        {new Date(pickup.createdAt).toLocaleString()}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Clean Pickup & Delivery Tabs */}
      {(activeTab === 'clean-pickup' || activeTab === 'deliver') && (
        <>
          {/* Barcode Scanner */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <QrCode className="w-5 h-5 text-cyan-600" />
              Teslimat Barkodunu Tara
            </h2>
            <div className="flex gap-3">
              <input
                type="text"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleScanBarcode()}
                placeholder="Barkodu tarayın veya girin..."
                className="flex-1 px-4 py-3 text-lg border rounded-lg focus:ring-2 focus:ring-cyan-500 font-mono"
                autoFocus
              />
              <button
                onClick={handleScanBarcode}
                disabled={scanMutation.isPending}
                className="px-6 py-3 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 disabled:opacity-50 font-medium"
              >
                {scanMutation.isPending ? 'Taranıyor...' : 'Bul'}
              </button>
            </div>
          </div>

          {/* Scanned Delivery Action */}
          {scannedDelivery && (
            <div className="bg-cyan-50 border-2 border-cyan-200 rounded-lg p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-cyan-900 mb-2">
                    {activeTab === 'clean-pickup' ? 'Toplama İçin Hazır' : 'Teslim Edilmeye Hazır'}
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-cyan-700">Barkod:</span>
                      <span className="font-mono font-bold text-xl">{scannedDelivery.barcode}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-cyan-700">Otel:</span>
                      <span className="font-medium">{scannedDelivery.tenant?.name}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-cyan-700">Ürünler:</span>
                      <span className="font-medium">{scannedDelivery.deliveryItems?.length || 0}</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setScannedDelivery(null)}
                    className="px-4 py-2 border border-cyan-300 text-cyan-700 rounded-lg hover:bg-cyan-100"
                  >
                    İptal
                  </button>
                  {activeTab === 'clean-pickup' ? (
                    <button
                      onClick={() => pickupMutation.mutate(scannedDelivery.id)}
                      disabled={pickupMutation.isPending}
                      className="flex items-center gap-2 px-6 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 disabled:opacity-50"
                    >
                      <Truck className="w-5 h-5" />
                      {pickupMutation.isPending ? 'İşleniyor...' : 'Toplamayı Onayla'}
                    </button>
                  ) : (
                    <button
                      onClick={() => deliverMutation.mutate(scannedDelivery.id)}
                      disabled={deliverMutation.isPending}
                      className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                    >
                      <CheckCircle className="w-5 h-5" />
                      {deliverMutation.isPending ? 'İşleniyor...' : 'Teslimatı Onayla'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Deliveries List */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                {activeTab === 'clean-pickup' ? (
                  <>
                    <Package className="w-5 h-5 text-indigo-600" />
                    Toplama İçin Hazır ({packaged.length})
                  </>
                ) : (
                  <>
                    <Truck className="w-5 h-5 text-cyan-600" />
                    Yolda - Teslim Edilmeye Hazır ({inTransit.length})
                  </>
                )}
              </h2>
            </div>
            {(activeTab === 'clean-pickup' ? loadingPackaged : loadingInTransit) ? (
              <div className="flex items-center justify-center h-48">
                <RefreshCw className="w-8 h-8 animate-spin text-cyan-500" />
              </div>
            ) : (activeTab === 'clean-pickup' ? packaged : inTransit).length === 0 ? (
              <div className="p-12 text-center">
                {activeTab === 'clean-pickup' ? (
                  <>
                    <Package className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                    <p className="text-xl text-gray-500">Toplama için hazır paket yok</p>
                  </>
                ) : (
                  <>
                    <Truck className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                    <p className="text-xl text-gray-500">Yolda teslimat yok</p>
                    <p className="text-gray-400 mt-2">Önce paketleri toplayın</p>
                  </>
                )}
              </div>
            ) : (
              <div className="divide-y">
                {(activeTab === 'clean-pickup' ? packaged : inTransit).map(delivery => (
                  <div key={delivery.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <span className="font-mono font-bold">{delivery.barcode}</span>
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            activeTab === 'clean-pickup'
                              ? 'bg-indigo-100 text-indigo-800'
                              : 'bg-cyan-100 text-cyan-800'
                          }`}>
                            {activeTab === 'clean-pickup' ? 'Paketlendi' : 'Yolda'}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 flex items-center gap-1">
                          <MapPin className="w-4 h-4" />
                          {delivery.tenant?.name}
                        </p>
                        {activeTab === 'deliver' && delivery.pickedUpAt && (
                          <p className="text-xs text-gray-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Toplandı: {new Date(delivery.pickedUpAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                      {activeTab === 'clean-pickup' ? (
                        <button
                          onClick={() => pickupMutation.mutate(delivery.id)}
                          disabled={pickupMutation.isPending}
                          className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 disabled:opacity-50"
                        >
                          <Truck className="w-4 h-4" />
                          Topla
                        </button>
                      ) : (
                        <button
                          onClick={() => deliverMutation.mutate(delivery.id)}
                          disabled={deliverMutation.isPending}
                          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                        >
                          <CheckCircle className="w-4 h-4" />
                          Teslim Et
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
