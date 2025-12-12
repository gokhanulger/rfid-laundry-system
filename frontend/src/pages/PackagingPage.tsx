import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Package, CheckCircle, RefreshCw, QrCode, Box, Trash2 } from 'lucide-react';
import { deliveriesApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import type { Delivery } from '../types';

type TabType = 'packaging' | 'history';

// Storage key for product counter (shared with ironer)
const PRODUCT_COUNTER_KEY = 'laundry_ironer_product_counter';

export function PackagingPage() {
  const [activeTab, setActiveTab] = useState<TabType>('packaging');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scannedDelivery, setScannedDelivery] = useState<Delivery | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  // Current shift for counter
  const [currentShift, setCurrentShift] = useState<'day' | 'night'>('day');

  // Determine current shift (day: 6:00-18:00, night: 18:00-6:00)
  useEffect(() => {
    const updateShift = () => {
      const hour = new Date().getHours();
      setCurrentShift(hour >= 6 && hour < 18 ? 'day' : 'night');
    };
    updateShift();
    const interval = setInterval(updateShift, 60000);
    return () => clearInterval(interval);
  }, []);

  // Increment product counter (updates localStorage, ironer page will read it)
  const incrementProductCounter = (count: number) => {
    const savedCounter = localStorage.getItem(PRODUCT_COUNTER_KEY);
    const currentCounter = savedCounter ? JSON.parse(savedCounter) : { day: 0, night: 0 };
    const newCounter = {
      ...currentCounter,
      [currentShift]: currentCounter[currentShift] + count
    };
    localStorage.setItem(PRODUCT_COUNTER_KEY, JSON.stringify(newCounter));
  };

  // Get deliveries that have labels printed (ready for packaging)
  // Auto-refresh every 5 seconds to catch new labels from ironer
  const { data: deliveries, isLoading, refetch } = useQuery({
    queryKey: ['deliveries', { status: 'label_printed' }],
    queryFn: () => deliveriesApi.getAll({ status: 'label_printed', limit: 50 }),
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  // Get recently packaged - also auto-refresh
  const { data: packagedDeliveries } = useQuery({
    queryKey: ['deliveries', { status: 'packaged' }],
    queryFn: () => deliveriesApi.getAll({ status: 'packaged', limit: 10 }),
    refetchInterval: 5000,
  });

  const scanMutation = useMutation({
    mutationFn: (barcode: string) => deliveriesApi.getByBarcode(barcode),
    onSuccess: (delivery) => {
      if (delivery.status === 'label_printed') {
        setScannedDelivery(delivery);
        toast.success('Teslimat bulundu!');
      } else if (delivery.status === 'packaged') {
        toast.warning('Bu teslimat zaten paketlendi');
      } else {
        toast.warning(`Teslimat durumu "${delivery.status}" - paketlenemez`);
      }
      setBarcodeInput('');
    },
    onError: (err) => {
      toast.error('Teslimat bulunamadı', getErrorMessage(err));
      setBarcodeInput('');
    },
  });

  // Track delivery being packaged for counter calculation
  const [packagingDelivery, setPackagingDelivery] = useState<Delivery | null>(null);

  const packageMutation = useMutation({
    mutationFn: deliveriesApi.package,
    onSuccess: () => {
      toast.success('Teslimat başarıyla paketlendi!');

      // Increment product counter based on delivery contents
      if (packagingDelivery) {
        let totalProducts = 0;
        if (packagingDelivery.notes) {
          try {
            const labelData = JSON.parse(packagingDelivery.notes);
            if (Array.isArray(labelData)) {
              totalProducts = labelData.reduce((sum: number, item: any) => sum + (item.count || 0), 0);
            }
          } catch {}
        }
        if (totalProducts === 0 && packagingDelivery.deliveryItems) {
          totalProducts = packagingDelivery.deliveryItems.length;
        }
        if (totalProducts > 0) {
          incrementProductCounter(totalProducts);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      setScannedDelivery(null);
      setPackagingDelivery(null);
    },
    onError: (err) => {
      toast.error('Paketleme başarısız', getErrorMessage(err));
      setPackagingDelivery(null);
    },
  });

  // Cancel/delete delivery mutation
  const cancelMutation = useMutation({
    mutationFn: deliveriesApi.cancel,
    onSuccess: () => {
      toast.success('Teslimat silindi!');
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      setScannedDelivery(null);
    },
    onError: (err) => toast.error('Silme başarısız', getErrorMessage(err)),
  });

  const handleScan = () => {
    if (!barcodeInput.trim()) return;
    scanMutation.mutate(barcodeInput.trim());
  };

  const handlePackage = (delivery: Delivery) => {
    setPackagingDelivery(delivery);
    packageMutation.mutate(delivery.id);
  };

  const handleDelete = (deliveryId: string) => {
    if (confirm('Bu teslimatı silmek istediğinize emin misiniz?')) {
      cancelMutation.mutate(deliveryId);
    }
  };

  const pendingDeliveries = deliveries?.data || [];
  const recentPackaged = packagedDeliveries?.data || [];

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-100 rounded-lg">
            <Package className="w-8 h-8 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Paketleme</h1>
            <p className="text-gray-500">Etiketleri tarayın ve teslimatları paketleyin</p>
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

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow">
        <div className="border-b">
          <div className="flex">
            <button
              onClick={() => setActiveTab('packaging')}
              className={`flex items-center gap-2 px-6 py-4 font-medium transition-colors ${
                activeTab === 'packaging'
                  ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Box className="w-5 h-5" />
              Paketleme ({pendingDeliveries.length})
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-2 px-6 py-4 font-medium transition-colors ${
                activeTab === 'history'
                  ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <CheckCircle className="w-5 h-5" />
              Son Paketlenenler ({recentPackaged.length})
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'packaging' ? (
            <div className="space-y-6">
              {/* Barcode Scanner */}
              <div className="bg-gray-50 rounded-lg p-6">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <QrCode className="w-5 h-5 text-indigo-600" />
                  Teslimat Barkodunu Tara
                </h2>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                    placeholder="Barkod tarayın veya girin..."
                    className="flex-1 px-4 py-3 text-lg border rounded-lg focus:ring-2 focus:ring-indigo-500 font-mono bg-white"
                    autoFocus
                  />
                  <button
                    onClick={handleScan}
                    disabled={scanMutation.isPending}
                    className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
                  >
                    {scanMutation.isPending ? 'Taranıyor...' : 'Bul'}
                  </button>
                </div>
              </div>

              {/* Scanned Delivery - Package Confirmation */}
              {scannedDelivery && (
                <div className="bg-indigo-50 border-2 border-indigo-200 rounded-lg p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-indigo-900 mb-2">Paketlemeye Hazır</h3>
                      <div className="space-y-2">
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-indigo-700">Barkod:</span>
                          <span className="font-mono font-bold text-xl">{scannedDelivery.barcode}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-indigo-700">Otel:</span>
                          <span className="font-medium">{scannedDelivery.tenant?.name}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-indigo-700">Ürünler:</span>
                          <span className="font-medium">{scannedDelivery.deliveryItems?.length || 0}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setScannedDelivery(null)}
                        className="px-4 py-2 border border-indigo-300 text-indigo-700 rounded-lg hover:bg-indigo-100"
                      >
                        İptal
                      </button>
                      <button
                        onClick={() => handleDelete(scannedDelivery.id)}
                        disabled={cancelMutation.isPending}
                        className="flex items-center gap-2 px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 disabled:opacity-50"
                      >
                        <Trash2 className="w-5 h-5" />
                        Sil
                      </button>
                      <button
                        onClick={() => handlePackage(scannedDelivery)}
                        disabled={packageMutation.isPending}
                        className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                      >
                        <Box className="w-5 h-5" />
                        {packageMutation.isPending ? 'İşleniyor...' : 'Paketi Onayla'}
                      </button>
                    </div>
                  </div>

                  {/* Items List */}
                  {scannedDelivery.deliveryItems && scannedDelivery.deliveryItems.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-indigo-200">
                      <p className="text-sm text-indigo-700 mb-2">Bu teslimattaki ürünler:</p>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {scannedDelivery.deliveryItems.map((di: any) => (
                          <div key={di.id} className="bg-white px-3 py-2 rounded border border-indigo-100">
                            <span className="font-mono text-sm">{di.item?.rfidTag}</span>
                            <span className="text-xs text-gray-500 ml-2">{di.item?.itemType?.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Pending Packaging List */}
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
                  <Box className="w-5 h-5 text-indigo-600" />
                  Paketleme Bekliyor
                </h2>

                {isLoading ? (
                  <div className="flex items-center justify-center h-48">
                    <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
                  </div>
                ) : pendingDeliveries.length === 0 ? (
                  <div className="p-12 text-center bg-gray-50 rounded-lg">
                    <Package className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                    <p className="text-xl text-gray-500">Paketleme bekleyen teslimat yok</p>
                    <p className="text-gray-400 mt-2">Önce etiketleri yazdırın</p>
                  </div>
                ) : (
                  <div className="divide-y border rounded-lg">
                    {pendingDeliveries.map(delivery => {
                      // Get item contents from notes or deliveryItems
                      let itemContents: { name: string; count: number }[] = [];
                      if (delivery.notes) {
                        try {
                          const labelData = JSON.parse(delivery.notes);
                          if (Array.isArray(labelData)) {
                            itemContents = labelData.map((item: any) => ({
                              name: item.typeName || 'Bilinmeyen',
                              count: item.count || 0
                            }));
                          }
                        } catch {}
                      }
                      if (itemContents.length === 0 && delivery.deliveryItems) {
                        const totals: Record<string, { name: string; count: number }> = {};
                        delivery.deliveryItems.forEach((di: any) => {
                          const typeName = di.item?.itemType?.name || 'Bilinmeyen';
                          if (!totals[typeName]) {
                            totals[typeName] = { name: typeName, count: 0 };
                          }
                          totals[typeName].count++;
                        });
                        itemContents = Object.values(totals);
                      }
                      const totalItems = itemContents.reduce((sum, item) => sum + item.count, 0);

                      return (
                        <div key={delivery.id} className="p-4 hover:bg-gray-50">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-1">
                                <span className="font-mono font-bold">{delivery.barcode}</span>
                                <span className="px-2 py-0.5 bg-purple-100 text-purple-800 rounded text-xs">
                                  Etiket Yazdırıldı
                                </span>
                              </div>
                              <p className="text-sm text-gray-600 mb-2">{delivery.tenant?.name}</p>

                              {/* Item Contents */}
                              {itemContents.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                  {itemContents.map((item, idx) => (
                                    <span key={idx} className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded text-xs font-medium">
                                      {item.name}: {item.count} adet
                                    </span>
                                  ))}
                                  <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-bold">
                                    Toplam: {totalItems}
                                  </span>
                                </div>
                              ) : (
                                <p className="text-xs text-gray-400">
                                  {delivery.deliveryItems?.length || 0} ürün
                                </p>
                              )}
                            </div>
                            <div className="flex gap-2 ml-4">
                              <button
                                onClick={() => handlePackage(delivery)}
                                disabled={packageMutation.isPending || cancelMutation.isPending}
                                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                              >
                                <Box className="w-4 h-4" />
                                Paketle
                              </button>
                              <button
                                onClick={() => handleDelete(delivery.id)}
                                disabled={cancelMutation.isPending || packageMutation.isPending}
                                className="flex items-center gap-2 px-3 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 disabled:opacity-50"
                                title="Teslimatı Sil"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* History Tab */
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
                <CheckCircle className="w-5 h-5 text-green-600" />
                Son Paketlenenler
              </h2>
              {recentPackaged.length === 0 ? (
                <div className="p-12 text-center bg-gray-50 rounded-lg">
                  <Package className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                  <p className="text-xl text-gray-500">Son paketlenen teslimat yok</p>
                </div>
              ) : (
                <div className="divide-y border rounded-lg">
                  {recentPackaged.map(delivery => (
                    <div key={delivery.id} className="p-4 hover:bg-gray-50">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-1">
                            <span className="font-mono font-bold text-lg">{delivery.barcode}</span>
                            <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                              Paketlendi
                            </span>
                          </div>
                          <p className="text-gray-600">{delivery.tenant?.name}</p>
                          <p className="text-sm text-gray-400 mt-1">
                            {delivery.packagedAt && new Date(delivery.packagedAt).toLocaleString('tr-TR')}
                          </p>
                          <p className="text-sm text-gray-500 mt-1">
                            {delivery.deliveryItems?.length || 0} ürün
                          </p>
                        </div>
                        <button
                          onClick={() => handleDelete(delivery.id)}
                          disabled={cancelMutation.isPending}
                          className="flex items-center gap-2 px-3 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 disabled:opacity-50"
                          title="Teslimatı Sil"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
