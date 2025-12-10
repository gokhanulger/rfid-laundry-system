import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Package, CheckCircle, RefreshCw, QrCode, Box } from 'lucide-react';
import { deliveriesApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import type { Delivery } from '../types';

type TabType = 'packaging' | 'history';

export function PackagingPage() {
  const [activeTab, setActiveTab] = useState<TabType>('packaging');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scannedDelivery, setScannedDelivery] = useState<Delivery | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  // Get deliveries that have labels printed (ready for packaging)
  const { data: deliveries, isLoading, refetch } = useQuery({
    queryKey: ['deliveries', { status: 'label_printed' }],
    queryFn: () => deliveriesApi.getAll({ status: 'label_printed', limit: 50 }),
  });

  // Get recently packaged
  const { data: packagedDeliveries } = useQuery({
    queryKey: ['deliveries', { status: 'packaged' }],
    queryFn: () => deliveriesApi.getAll({ status: 'packaged', limit: 10 }),
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

  const packageMutation = useMutation({
    mutationFn: deliveriesApi.package,
    onSuccess: () => {
      toast.success('Teslimat başarıyla paketlendi!');
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      setScannedDelivery(null);
    },
    onError: (err) => toast.error('Paketleme başarısız', getErrorMessage(err)),
  });

  const handleScan = () => {
    if (!barcodeInput.trim()) return;
    scanMutation.mutate(barcodeInput.trim());
  };

  const handlePackage = (deliveryId: string) => {
    packageMutation.mutate(deliveryId);
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
                        onClick={() => handlePackage(scannedDelivery.id)}
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
                            <button
                              onClick={() => handlePackage(delivery.id)}
                              disabled={packageMutation.isPending}
                              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 ml-4"
                            >
                              <Box className="w-4 h-4" />
                              Paketle
                            </button>
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
                      <div className="flex items-center justify-between mb-1">
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
