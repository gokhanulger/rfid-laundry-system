import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Truck, Building2, CheckCircle, RefreshCw, Package, MapPin, Navigation,
  ArrowLeft, QrCode, ChevronRight, Scan
} from 'lucide-react';
import { deliveriesApi, getErrorMessage } from '../../lib/api';
import { useToast } from '../../components/Toast';
import type { Delivery } from '../../types';

type DeliveryStep = 'select' | 'laundry-pickup' | 'hotel-delivery';

export function DeliveryPage() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<DeliveryStep>('select');
  const [selectedDeliveries, setSelectedDeliveries] = useState<string[]>([]);
  const [locationPermission, setLocationPermission] = useState<'prompt' | 'granted' | 'denied' | 'checking'>('checking');
  const [barcodeInput, setBarcodeInput] = useState('');
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  // Check location permission on mount
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationPermission('denied');
      return;
    }

    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then((result) => {
        setLocationPermission(result.state as 'prompt' | 'granted' | 'denied');
        result.addEventListener('change', () => {
          setLocationPermission(result.state as 'prompt' | 'granted' | 'denied');
        });
      }).catch(() => {
        setLocationPermission('prompt');
      });
    } else {
      setLocationPermission('prompt');
    }
  }, []);

  const requestLocationPermission = () => {
    if (!navigator.geolocation) {
      toast.error('Tarayıcınız konum özelliğini desteklemiyor');
      return;
    }

    toast.info('Konum izni isteniyor...');
    navigator.geolocation.getCurrentPosition(
      () => {
        setLocationPermission('granted');
        toast.success('Konum erişimi onaylandı!');
      },
      (error) => {
        setLocationPermission('denied');
        if (error.code === error.PERMISSION_DENIED) {
          toast.error('Konum izni reddedildi. Ayarlardan açın.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // Get deliveries ready for pickup from laundry (packaged)
  const { data: readyDeliveries, isLoading: loadingReady, refetch: refetchReady } = useQuery({
    queryKey: ['deliveries', { status: 'packaged' }],
    queryFn: () => deliveriesApi.getAll({ status: 'packaged', limit: 50 }),
  });

  // Get deliveries picked up (ready for hotel delivery)
  const { data: inTransitDeliveries, isLoading: loadingTransit, refetch: refetchTransit } = useQuery({
    queryKey: ['deliveries', { status: 'picked_up' }],
    queryFn: () => deliveriesApi.getAll({ status: 'picked_up', limit: 50 }),
  });

  // Pickup from laundry mutation
  const pickupMutation = useMutation({
    mutationFn: (deliveryId: string) => deliveriesApi.pickup(deliveryId),
    onSuccess: () => {
      toast.success('Paket çamaşırhaneden alındı!');
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      setSelectedDeliveries([]);
      refetchReady();
      refetchTransit();
    },
    onError: (err) => toast.error('Toplama başarısız', getErrorMessage(err)),
  });

  // Deliver to hotel mutation
  const deliverMutation = useMutation({
    mutationFn: async (deliveryId: string) => {
      return new Promise<Delivery>((resolve, reject) => {
        if (!navigator.geolocation) {
          deliveriesApi.deliver(deliveryId).then(resolve).catch(reject);
          return;
        }

        navigator.geolocation.getCurrentPosition(
          async (position) => {
            try {
              const delivery = await deliveriesApi.deliver(deliveryId, {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
              });
              resolve(delivery);
            } catch (error) {
              reject(error);
            }
          },
          () => {
            deliveriesApi.deliver(deliveryId).then(resolve).catch(reject);
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      });
    },
    onSuccess: () => {
      toast.success('Teslimat tamamlandı!');
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      setSelectedDeliveries([]);
      refetchTransit();
    },
    onError: (err) => toast.error('Teslim başarısız', getErrorMessage(err)),
  });

  const handlePickup = (deliveryId: string) => pickupMutation.mutate(deliveryId);
  const handleDeliver = (deliveryId: string) => deliverMutation.mutate(deliveryId);

  const handleBulkAction = async (action: 'pickup' | 'deliver') => {
    for (const id of selectedDeliveries) {
      if (action === 'pickup') {
        await pickupMutation.mutateAsync(id);
      } else {
        await deliverMutation.mutateAsync(id);
      }
    }
    setSelectedDeliveries([]);
  };

  const toggleSelection = (id: string) => {
    setSelectedDeliveries(prev =>
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
    );
  };

  const readyList = readyDeliveries?.data || [];
  const transitList = inTransitDeliveries?.data || [];

  // Group by hotel
  const groupByHotel = (list: Delivery[]) => {
    return list.reduce((acc: Record<string, Delivery[]>, delivery: Delivery) => {
      const hotelName = delivery.tenant?.name || 'Bilinmeyen';
      if (!acc[hotelName]) acc[hotelName] = [];
      acc[hotelName].push(delivery);
      return acc;
    }, {});
  };

  // Get item contents from delivery
  const getDeliveryContents = (delivery: Delivery) => {
    let items: { name: string; count: number }[] = [];
    if (delivery.notes) {
      try {
        const labelData = JSON.parse(delivery.notes);
        if (Array.isArray(labelData)) {
          items = labelData.map((item: any) => ({
            name: item.typeName || 'Bilinmeyen',
            count: item.count || 0
          }));
        }
      } catch {}
    }
    if (items.length === 0 && delivery.deliveryItems) {
      const totals: Record<string, { name: string; count: number }> = {};
      delivery.deliveryItems.forEach((di: any) => {
        const typeName = di.item?.itemType?.name || 'Bilinmeyen';
        if (!totals[typeName]) {
          totals[typeName] = { name: typeName, count: 0 };
        }
        totals[typeName].count++;
      });
      items = Object.values(totals);
    }
    return items;
  };

  // Get total items for a hotel's deliveries
  const getHotelTotals = (deliveries: Delivery[]) => {
    const totals: Record<string, { name: string; count: number }> = {};
    deliveries.forEach(delivery => {
      const contents = getDeliveryContents(delivery);
      contents.forEach(item => {
        if (!totals[item.name]) {
          totals[item.name] = { name: item.name, count: 0 };
        }
        totals[item.name].count += item.count;
      });
    });
    return Object.values(totals);
  };

  const readyByHotel = groupByHotel(readyList);
  const transitByHotel = groupByHotel(transitList);

  // Auto-focus barcode input when on pickup/delivery screen
  useEffect(() => {
    if (currentStep !== 'select' && barcodeInputRef.current) {
      setTimeout(() => barcodeInputRef.current?.focus(), 100);
    }
    setBarcodeInput('');
  }, [currentStep]);

  // Handle barcode scan for pickup
  const handleBarcodeScanForPickup = (barcode: string) => {
    const delivery = readyList.find(d => d.barcode === barcode);
    if (delivery) {
      handlePickup(delivery.id);
      toast.success(`Paket alındı: ${barcode}`);
    } else {
      toast.error('Paket bulunamadı', `"${barcode}" barkodlu paket listede yok`);
    }
    setBarcodeInput('');
    barcodeInputRef.current?.focus();
  };

  // Handle barcode scan for delivery
  const handleBarcodeScanForDelivery = (barcode: string) => {
    const delivery = transitList.find(d => d.barcode === barcode);
    if (delivery) {
      handleDeliver(delivery.id);
      toast.success(`Paket teslim edildi: ${barcode}`);
    } else {
      toast.error('Paket bulunamadı', `"${barcode}" barkodlu paket listede yok`);
    }
    setBarcodeInput('');
    barcodeInputRef.current?.focus();
  };

  const handleBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, action: 'pickup' | 'deliver') => {
    if (e.key === 'Enter' && barcodeInput.trim()) {
      e.preventDefault();
      if (action === 'pickup') {
        handleBarcodeScanForPickup(barcodeInput.trim());
      } else {
        handleBarcodeScanForDelivery(barcodeInput.trim());
      }
    }
  };

  // Step Selection Screen
  if (currentStep === 'select') {
    return (
      <div className="p-4 md:p-6 min-h-screen bg-gray-50">
        {/* Back Button */}
        <button
          onClick={() => navigate('/driver')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 touch-manipulation"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Ana Sayfa</span>
        </button>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex p-4 bg-green-100 rounded-2xl mb-4">
            <Truck className="w-12 h-12 text-green-600" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">Teslim Etme</h1>
          <p className="text-gray-500">Hangi adımı yapmak istiyorsunuz?</p>
        </div>

        {/* Step Cards */}
        <div className="max-w-xl mx-auto space-y-4">
          {/* Step 1: Laundry Pickup */}
          <button
            onClick={() => {
              setCurrentStep('laundry-pickup');
              setSelectedDeliveries([]);
            }}
            className="w-full bg-white rounded-2xl shadow-lg p-5 md:p-6 text-left hover:shadow-xl active:bg-gray-50 transition-all touch-manipulation border-2 border-transparent hover:border-purple-200"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-purple-100 rounded-xl">
                  <Package className="w-8 h-8 text-purple-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">1. Çamaşırhaneden Al</h3>
                  <p className="text-sm text-gray-500">Paketlenmiş ürünleri topla</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {readyList.length > 0 && (
                  <span className="bg-purple-100 text-purple-700 px-3 py-1 rounded-full font-bold">
                    {readyList.length}
                  </span>
                )}
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </div>
            </div>
          </button>

          {/* Step 2: Hotel Delivery */}
          <button
            onClick={() => {
              setCurrentStep('hotel-delivery');
              setSelectedDeliveries([]);
            }}
            className="w-full bg-white rounded-2xl shadow-lg p-5 md:p-6 text-left hover:shadow-xl active:bg-gray-50 transition-all touch-manipulation border-2 border-transparent hover:border-green-200"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-100 rounded-xl">
                  <Building2 className="w-8 h-8 text-green-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">2. Otellere Teslim Et</h3>
                  <p className="text-sm text-gray-500">Temiz paketleri teslim et</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {transitList.length > 0 && (
                  <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full font-bold">
                    {transitList.length}
                  </span>
                )}
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </div>
            </div>
          </button>
        </div>

        {/* Summary */}
        <div className="max-w-xl mx-auto mt-8">
          <div className="bg-gradient-to-r from-green-500 to-green-600 rounded-2xl p-5 text-white">
            <h3 className="font-bold mb-3">Teslim Özeti</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/20 rounded-xl p-3 text-center">
                <p className="text-3xl font-bold">{readyList.length}</p>
                <p className="text-sm text-green-100">Çamaşırhanede Hazır</p>
              </div>
              <div className="bg-white/20 rounded-xl p-3 text-center">
                <p className="text-3xl font-bold">{transitList.length}</p>
                <p className="text-sm text-green-100">Teslim Edilecek</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Laundry Pickup Screen
  if (currentStep === 'laundry-pickup') {
    return (
      <div className="p-4 md:p-6 min-h-screen bg-gray-50">
        {/* Back Button */}
        <button
          onClick={() => setCurrentStep('select')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 touch-manipulation"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Geri</span>
        </button>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-100 rounded-xl">
              <Package className="w-8 h-8 text-purple-600" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-gray-900">Çamaşırhaneden Al</h1>
              <p className="text-sm text-gray-500">Paketlenmiş ürünleri topla</p>
            </div>
          </div>
          <button
            onClick={() => refetchReady()}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-xl touch-manipulation"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>

        {/* Barcode Scanner Input */}
        <div className="bg-purple-50 border-2 border-purple-200 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-3 mb-2">
            <Scan className="w-5 h-5 text-purple-600" />
            <span className="font-medium text-purple-900">Barkod Tara</span>
          </div>
          <input
            ref={barcodeInputRef}
            type="text"
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
            onKeyDown={(e) => handleBarcodeKeyDown(e, 'pickup')}
            placeholder="Cihaz tuşuna basın veya barkod girin..."
            className="w-full px-4 py-3 text-lg border-2 border-purple-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono bg-white"
            autoComplete="off"
          />
          <p className="text-xs text-purple-600 mt-2">Tarayıcı tuşuna basarak barkodu okutun</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-white rounded-xl shadow p-3 text-center">
            <p className="text-2xl font-bold text-purple-600">{readyList.length}</p>
            <p className="text-xs text-gray-500">Hazır</p>
          </div>
          <div className="bg-white rounded-xl shadow p-3 text-center">
            <p className="text-2xl font-bold text-blue-600">{Object.keys(readyByHotel).length}</p>
            <p className="text-xs text-gray-500">Otel</p>
          </div>
          <div className="bg-white rounded-xl shadow p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{selectedDeliveries.length}</p>
            <p className="text-xs text-gray-500">Seçili</p>
          </div>
        </div>

        {/* Bulk Action */}
        {selectedDeliveries.length > 0 && (
          <div className="bg-purple-600 text-white rounded-xl p-4 mb-4 flex items-center justify-between">
            <span className="font-bold">{selectedDeliveries.length} paket seçildi</span>
            <button
              onClick={() => handleBulkAction('pickup')}
              disabled={pickupMutation.isPending}
              className="px-4 py-2 bg-white text-purple-600 rounded-xl font-bold touch-manipulation"
            >
              Seçilenleri Al
            </button>
          </div>
        )}

        {/* Content */}
        {loadingReady ? (
          <div className="flex justify-center py-16">
            <RefreshCw className="w-10 h-10 animate-spin text-purple-500" />
          </div>
        ) : readyList.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <Package className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <p className="text-xl font-semibold text-gray-500">Alınacak paket yok</p>
            <p className="text-sm text-gray-400 mt-2">Paketleme tamamlanınca burada görünecek</p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(readyByHotel).map(([hotelName, deliveries]) => {
              const hotelTotals = getHotelTotals(deliveries);
              const totalItems = hotelTotals.reduce((sum, item) => sum + item.count, 0);

              return (
                <div key={hotelName} className="bg-white rounded-2xl shadow-lg overflow-hidden">
                  <div className="bg-gradient-to-r from-purple-600 to-purple-500 px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-6 h-6 text-white" />
                        <div>
                          <h3 className="font-bold text-white">{hotelName}</h3>
                          <p className="text-purple-100 text-xs">{deliveries.length} paket • {totalItems} ürün</p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const ids = deliveries.map(d => d.id);
                          const allSelected = ids.every(id => selectedDeliveries.includes(id));
                          if (allSelected) {
                            setSelectedDeliveries(prev => prev.filter(id => !ids.includes(id)));
                          } else {
                            setSelectedDeliveries(prev => [...new Set([...prev, ...ids])]);
                          }
                        }}
                        className="px-3 py-1.5 bg-white/20 text-white rounded-lg text-sm touch-manipulation"
                      >
                        {deliveries.every(d => selectedDeliveries.includes(d.id)) ? 'Kaldır' : 'Tümünü Seç'}
                      </button>
                    </div>
                  </div>

                  {/* Hotel Total Contents */}
                  {hotelTotals.length > 0 && (
                    <div className="px-4 py-2 bg-purple-50 border-b flex flex-wrap gap-2">
                      {hotelTotals.map((item, idx) => (
                        <span key={idx} className="px-2 py-1 bg-white text-purple-700 rounded text-xs font-medium shadow-sm">
                          {item.name}: {item.count}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="divide-y">
                    {deliveries.map((delivery) => {
                      const contents = getDeliveryContents(delivery);
                      const itemCount = contents.reduce((sum, item) => sum + item.count, 0);

                      return (
                        <div
                          key={delivery.id}
                          className={`p-3 ${
                            selectedDeliveries.includes(delivery.id) ? 'bg-purple-50' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <label className="flex items-center gap-3 flex-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedDeliveries.includes(delivery.id)}
                                onChange={() => toggleSelection(delivery.id)}
                                className="w-5 h-5 text-purple-600 rounded touch-manipulation"
                              />
                              <QrCode className="w-6 h-6 text-gray-400" />
                              <div>
                                <p className="font-mono font-bold text-sm">{delivery.barcode}</p>
                                <p className="text-xs text-gray-500">{itemCount} ürün</p>
                              </div>
                            </label>
                            <button
                              onClick={() => handlePickup(delivery.id)}
                              disabled={pickupMutation.isPending}
                              className="px-3 py-2 bg-purple-600 text-white rounded-xl font-medium text-sm touch-manipulation"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          </div>
                          {/* Package Contents */}
                          {contents.length > 0 && (
                            <div className="ml-8 flex flex-wrap gap-1">
                              {contents.map((item, idx) => (
                                <span key={idx} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                                  {item.name}: {item.count}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Hotel Delivery Screen
  return (
    <div className="p-4 md:p-6 min-h-screen bg-gray-50">
      {/* Back Button */}
      <button
        onClick={() => setCurrentStep('select')}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 touch-manipulation"
      >
        <ArrowLeft className="w-5 h-5" />
        <span>Geri</span>
      </button>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-green-100 rounded-xl">
            <Truck className="w-8 h-8 text-green-600" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">Otellere Teslim Et</h1>
            <p className="text-sm text-gray-500">Temiz paketleri teslim et</p>
          </div>
        </div>
        <button
          onClick={() => refetchTransit()}
          className="p-2 text-gray-500 hover:bg-gray-100 rounded-xl touch-manipulation"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {/* Location Permission Banner */}
      {locationPermission !== 'granted' && (
        <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-4 mb-4">
          <div className="flex items-start gap-3">
            <MapPin className="w-6 h-6 text-yellow-600 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="font-bold text-yellow-900 text-sm">Konum İzni Gerekli</h3>
              <p className="text-xs text-yellow-800 mb-2">
                Teslimat konumunu kaydetmek için izin verin.
              </p>
              <button
                onClick={requestLocationPermission}
                className="flex items-center gap-2 px-3 py-2 bg-yellow-600 text-white rounded-lg text-sm font-medium touch-manipulation"
              >
                <Navigation className="w-4 h-4" />
                İzin Ver
              </button>
            </div>
          </div>
        </div>
      )}

      {locationPermission === 'granted' && (
        <div className="bg-green-50 border border-green-300 rounded-xl p-3 mb-4 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-600" />
          <span className="text-sm text-green-800">Konum aktif</span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white rounded-xl shadow p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{transitList.length}</p>
          <p className="text-xs text-gray-500">Teslim Edilecek</p>
        </div>
        <div className="bg-white rounded-xl shadow p-3 text-center">
          <p className="text-2xl font-bold text-blue-600">{Object.keys(transitByHotel).length}</p>
          <p className="text-xs text-gray-500">Otel</p>
        </div>
        <div className="bg-white rounded-xl shadow p-3 text-center">
          <p className="text-2xl font-bold text-purple-600">{selectedDeliveries.length}</p>
          <p className="text-xs text-gray-500">Seçili</p>
        </div>
      </div>

      {/* Bulk Action */}
      {selectedDeliveries.length > 0 && (
        <div className="bg-green-600 text-white rounded-xl p-4 mb-4 flex items-center justify-between">
          <span className="font-bold">{selectedDeliveries.length} paket seçildi</span>
          <button
            onClick={() => handleBulkAction('deliver')}
            disabled={deliverMutation.isPending}
            className="px-4 py-2 bg-white text-green-600 rounded-xl font-bold touch-manipulation"
          >
            Seçilenleri Teslim Et
          </button>
        </div>
      )}

      {/* Content */}
      {loadingTransit ? (
        <div className="flex justify-center py-16">
          <RefreshCw className="w-10 h-10 animate-spin text-green-500" />
        </div>
      ) : transitList.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
          <Truck className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <p className="text-xl font-semibold text-gray-500">Teslim edilecek paket yok</p>
          <p className="text-sm text-gray-400 mt-2">Önce çamaşırhaneden paket alın</p>
          <button
            onClick={() => setCurrentStep('laundry-pickup')}
            className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-xl font-medium touch-manipulation"
          >
            Çamaşırhaneden Al
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(transitByHotel).map(([hotelName, deliveries]) => {
            const hotelTotals = getHotelTotals(deliveries);
            const totalItems = hotelTotals.reduce((sum, item) => sum + item.count, 0);

            return (
              <div key={hotelName} className="bg-white rounded-2xl shadow-lg overflow-hidden">
                <div className="bg-gradient-to-r from-green-600 to-green-500 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-6 h-6 text-white" />
                      <div>
                        <h3 className="font-bold text-white">{hotelName}</h3>
                        <p className="text-green-100 text-xs flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {deliveries.length} paket • {totalItems} ürün
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        const ids = deliveries.map(d => d.id);
                        const allSelected = ids.every(id => selectedDeliveries.includes(id));
                        if (allSelected) {
                          setSelectedDeliveries(prev => prev.filter(id => !ids.includes(id)));
                        } else {
                          setSelectedDeliveries(prev => [...new Set([...prev, ...ids])]);
                        }
                      }}
                      className="px-3 py-1.5 bg-white/20 text-white rounded-lg text-sm touch-manipulation"
                    >
                      {deliveries.every(d => selectedDeliveries.includes(d.id)) ? 'Kaldır' : 'Tümünü Seç'}
                    </button>
                  </div>
                </div>

                {/* Hotel Total Contents */}
                {hotelTotals.length > 0 && (
                  <div className="px-4 py-2 bg-green-50 border-b flex flex-wrap gap-2">
                    {hotelTotals.map((item, idx) => (
                      <span key={idx} className="px-2 py-1 bg-white text-green-700 rounded text-xs font-medium shadow-sm">
                        {item.name}: {item.count}
                      </span>
                    ))}
                  </div>
                )}

                <div className="divide-y">
                  {deliveries.map((delivery) => {
                    const contents = getDeliveryContents(delivery);
                    const itemCount = contents.reduce((sum, item) => sum + item.count, 0);

                    return (
                      <div
                        key={delivery.id}
                        className={`p-3 ${
                          selectedDeliveries.includes(delivery.id) ? 'bg-green-50' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <label className="flex items-center gap-3 flex-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedDeliveries.includes(delivery.id)}
                              onChange={() => toggleSelection(delivery.id)}
                              className="w-5 h-5 text-green-600 rounded touch-manipulation"
                            />
                            <Package className="w-6 h-6 text-gray-400" />
                            <div>
                              <p className="font-mono font-bold text-sm">{delivery.barcode}</p>
                              <p className="text-xs text-gray-500">{itemCount} ürün</p>
                            </div>
                          </label>
                          <button
                            onClick={() => handleDeliver(delivery.id)}
                            disabled={deliverMutation.isPending}
                            className="px-3 py-2 bg-green-600 text-white rounded-xl font-medium text-sm touch-manipulation"
                          >
                            <CheckCircle className="w-4 h-4" />
                          </button>
                        </div>
                        {/* Package Contents */}
                        {contents.length > 0 && (
                          <div className="ml-8 flex flex-wrap gap-1">
                            {contents.map((item, idx) => (
                              <span key={idx} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                                {item.name}: {item.count}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
