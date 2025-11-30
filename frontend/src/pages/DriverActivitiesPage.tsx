import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, Package, CheckCircle, RefreshCw, QrCode, MapPin, User, Navigation } from 'lucide-react';
import { deliveriesApi, settingsApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import type { Delivery, User as UserType } from '../types';

type TabType = 'scan-packages' | 'deliver';

const DRIVER_ID_KEY = 'selected_driver_id';

export function DriverActivitiesPage() {
  const [activeTab, setActiveTab] = useState<TabType>('scan-packages');
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [showDriverSelection, setShowDriverSelection] = useState(false);
  const [packageBarcodeInput, setPackageBarcodeInput] = useState('');
  const [deliveryBarcodeInput, setDeliveryBarcodeInput] = useState('');
  const [scannedDelivery, setScannedDelivery] = useState<Delivery | null>(null);
  const [locationPermission, setLocationPermission] = useState<'prompt' | 'granted' | 'denied' | 'checking'>('checking');

  const queryClient = useQueryClient();
  const toast = useToast();

  // Load selected driver from localStorage
  useEffect(() => {
    const savedDriverId = localStorage.getItem(DRIVER_ID_KEY);
    if (savedDriverId) {
      setSelectedDriverId(savedDriverId);
    } else {
      setShowDriverSelection(true);
    }
  }, []);

  // Check location permission on mount and when deliver tab is active
  useEffect(() => {
    if (activeTab !== 'deliver') return;

    if (!navigator.geolocation) {
      setLocationPermission('denied');
      return;
    }

    // Check current permission state
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then((result) => {
        setLocationPermission(result.state as 'prompt' | 'granted' | 'denied');

        // Listen for permission changes
        result.addEventListener('change', () => {
          setLocationPermission(result.state as 'prompt' | 'granted' | 'denied');
        });
      }).catch(() => {
        setLocationPermission('prompt');
      });
    } else {
      setLocationPermission('prompt');
    }
  }, [activeTab]);

  // Save selected driver to localStorage
  const selectDriver = (driverId: string) => {
    setSelectedDriverId(driverId);
    localStorage.setItem(DRIVER_ID_KEY, driverId);
    setShowDriverSelection(false);
  };

  // Request location permission proactively
  const requestLocationPermission = () => {
    if (!navigator.geolocation) {
      toast.error('Tarayıcınız konum özelliğini desteklemiyor');
      return;
    }

    toast.info('Konum izni isteniyor...');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationPermission('granted');
        toast.success(`Konum erişimi onaylandı!`);
        console.log('📍 Location permission granted:', position.coords.latitude, position.coords.longitude);
      },
      (error) => {
        setLocationPermission('denied');
        let errorMsg = 'Konum erişimi reddedildi';
        if (error.code === error.PERMISSION_DENIED) {
          errorMsg = 'Konum izni reddedildi. Tarayıcı ayarlarından konum iznini açın.';
        }
        toast.error(errorMsg);
        console.error('Geolocation error:', error);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  // Get all users with driver role
  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: settingsApi.getUsers,
  });

  const drivers = users ? users.filter((u: UserType) => u.role === 'driver') : [];
  const selectedDriver = drivers.find((d: UserType) => d.id === selectedDriverId);

  // Get deliveries for the selected driver (picked up, ready to deliver)
  const { data: inTransitDeliveries, isLoading: loadingInTransit, refetch: refetchInTransit } = useQuery({
    queryKey: ['deliveries', { status: 'picked_up', driverId: selectedDriverId }],
    queryFn: () => deliveriesApi.getAll({ status: 'picked_up', driverId: selectedDriverId!, limit: 50 }),
    enabled: !!selectedDriverId,
  });

  // Get packaged deliveries (available for scanning)
  const { data: packagedDeliveries, isLoading: loadingPackaged, refetch: refetchPackaged } = useQuery({
    queryKey: ['deliveries', { status: 'packaged' }],
    queryFn: () => deliveriesApi.getAll({ status: 'packaged', limit: 50 }),
  });

  // Scan package mutation
  const scanPackageMutation = useMutation({
    mutationFn: deliveriesApi.scanPackage,
    onSuccess: (data) => {
      toast.success(`Paket tarandı! ${data.scannedPackages}/${data.totalPackages}`);
      if (data.allPackagesScanned) {
        toast.success('Tüm paketler tarandı! Teslimat için hazır.');
      }
      setPackageBarcodeInput('');
      refetchPackaged();
      refetchInTransit();
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
    },
    onError: (err) => toast.error('Paket taranamadı', getErrorMessage(err)),
  });

  // Get location and deliver mutation
  const deliverMutation = useMutation({
    mutationFn: async (deliveryId: string) => {
      return new Promise<Delivery>((resolve, reject) => {
        if (!navigator.geolocation) {
          toast.warning('Konum desteklenmiyor, konumsuz teslim ediliyor');
          deliveriesApi.deliver(deliveryId).then(resolve).catch(reject);
          return;
        }

        toast.info('Konum bilgisi alınıyor...');

        navigator.geolocation.getCurrentPosition(
          async (position) => {
            try {
              console.log('📍 Location captured:', position.coords.latitude, position.coords.longitude);
              const delivery = await deliveriesApi.deliver(deliveryId, {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
              });
              console.log('✅ Delivery response:', delivery);
              if (delivery.deliveryLatitude && delivery.deliveryLongitude) {
                toast.success(`Teslimat tamamlandı! Konum kaydedildi.`);
              } else {
                toast.warning('Teslimat tamamlandı ama konum kaydedilmedi.');
              }
              setLocationPermission('granted');
              resolve(delivery);
            } catch (error) {
              reject(error);
            }
          },
          (error) => {
            console.error('❌ Geolocation error:', error);
            let errorMsg = 'Konum alınamadı';
            if (error.code === error.PERMISSION_DENIED) {
              setLocationPermission('denied');
              errorMsg = 'Konum izni reddedildi. Ayarlardan konum iznini açın.';
            } else if (error.code === error.TIMEOUT) {
              errorMsg = 'Konum alınırken zaman aşımı. Konumsuz teslim ediliyor.';
            }
            toast.warning(errorMsg);
            deliveriesApi.deliver(deliveryId).then(resolve).catch(reject);
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          }
        );
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      setScannedDelivery(null);
      refetchInTransit();
    },
    onError: (err) => toast.error('Teslimat başarısız', getErrorMessage(err)),
  });

  const handleScanPackage = () => {
    if (!packageBarcodeInput.trim()) return;
    scanPackageMutation.mutate(packageBarcodeInput.trim());
  };

  const handleScanDeliveryBarcode = async () => {
    if (!deliveryBarcodeInput.trim()) return;
    try {
      const delivery = await deliveriesApi.getByBarcode(deliveryBarcodeInput.trim());
      if (delivery.status === 'picked_up' && delivery.driverId === selectedDriverId) {
        setScannedDelivery(delivery);
        toast.success('Teslimat için hazır!');
      } else {
        toast.warning(`Teslimat yapılamaz - durumu "${delivery.status}" veya başka bir sürücüye atanmış`);
      }
      setDeliveryBarcodeInput('');
    } catch (err) {
      toast.error('Teslimat bulunamadı', getErrorMessage(err));
      setDeliveryBarcodeInput('');
    }
  };

  const handleRefresh = () => {
    refetchPackaged();
    refetchInTransit();
  };

  const packaged = packagedDeliveries?.data || [];
  const inTransit = inTransitDeliveries?.data || [];

  // Driver Selection Dialog
  const DriverSelectionDialog = () => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-cyan-100 rounded-lg">
            <User className="w-6 h-6 text-cyan-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Sürücü Seç</h2>
            <p className="text-sm text-gray-500">Devam etmek için sürücü seçin</p>
          </div>
        </div>

        <div className="space-y-2 max-h-96 overflow-y-auto mb-6">
          {drivers.length === 0 ? (
            <p className="text-gray-500 text-center py-4">Kayıtlı sürücü yok</p>
          ) : (
            drivers.map((driver: UserType) => (
              <button
                key={driver.id}
                onClick={() => selectDriver(driver.id)}
                className="w-full flex items-center gap-3 p-4 border-2 border-gray-200 rounded-lg hover:border-cyan-500 hover:bg-cyan-50 transition-all text-left"
              >
                <div className="p-2 bg-cyan-100 rounded-full">
                  <User className="w-5 h-5 text-cyan-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">
                    {driver.firstName} {driver.lastName}
                  </p>
                  <p className="text-sm text-gray-500">{driver.email}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );

  // Show driver selection if no driver selected
  if (!selectedDriverId || showDriverSelection) {
    return <DriverSelectionDialog />;
  }

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-cyan-100 rounded-lg">
            <Truck className="w-8 h-8 text-cyan-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Sürücü Aktiviteleri</h1>
            <p className="text-gray-500">
              Sürücü: {selectedDriver?.firstName} {selectedDriver?.lastName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDriverSelection(true)}
            className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <User className="w-4 h-4" />
            Sürücü Değiştir
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

      {/* Tab Selector */}
      <div className="bg-white rounded-lg shadow p-1 inline-flex gap-1">
        <button
          onClick={() => { setActiveTab('scan-packages'); setScannedDelivery(null); }}
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'scan-packages'
              ? 'bg-cyan-600 text-white'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <div className="flex items-center gap-2">
            <QrCode className="w-4 h-4" />
            Paket Tara
          </div>
        </button>
        <button
          onClick={() => { setActiveTab('deliver'); setScannedDelivery(null); }}
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'deliver'
              ? 'bg-green-600 text-white'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4" />
            Teslimat Yap ({inTransit.length})
          </div>
        </button>
      </div>

      {/* Scan Packages Tab */}
      {activeTab === 'scan-packages' && (
        <>
          {/* Package Scanner */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <QrCode className="w-5 h-5 text-cyan-600" />
              Paket Barkodunu Tara
            </h2>
            <div className="flex gap-3">
              <input
                type="text"
                value={packageBarcodeInput}
                onChange={(e) => setPackageBarcodeInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleScanPackage()}
                placeholder="Paket barkodunu tarayın veya girin..."
                className="flex-1 px-4 py-3 text-lg border rounded-lg focus:ring-2 focus:ring-cyan-500 font-mono"
                autoFocus
              />
              <button
                onClick={handleScanPackage}
                disabled={scanPackageMutation.isPending}
                className="px-6 py-3 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 disabled:opacity-50 font-medium"
              >
                {scanPackageMutation.isPending ? 'Taranıyor...' : 'Tara'}
              </button>
            </div>
          </div>

          {/* Available Packages */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Package className="w-5 h-5 text-indigo-600" />
                Taranabilir Paketler ({packaged.length})
              </h2>
            </div>
            {loadingPackaged ? (
              <div className="flex items-center justify-center h-48">
                <RefreshCw className="w-8 h-8 animate-spin text-cyan-500" />
              </div>
            ) : packaged.length === 0 ? (
              <div className="p-12 text-center">
                <Package className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                <p className="text-xl text-gray-500">Taranacak paket yok</p>
              </div>
            ) : (
              <div className="divide-y">
                {packaged.map(delivery => (
                  <div key={delivery.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <span className="font-mono font-bold">{delivery.barcode}</span>
                          <span className="px-2 py-0.5 rounded text-xs bg-indigo-100 text-indigo-800">
                            Paketlendi
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 flex items-center gap-1">
                          <MapPin className="w-4 h-4" />
                          {delivery.tenant?.name}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {delivery.packageCount} paket
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Deliver Tab */}
      {activeTab === 'deliver' && (
        <>
          {/* Location Permission Status */}
          {locationPermission !== 'granted' && (
            <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <MapPin className="w-6 h-6 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h3 className="font-semibold text-yellow-900 mb-1">⚠️ Konum İzni Gerekli</h3>
                  <p className="text-sm text-yellow-800 mb-3">
                    Teslimat sırasında konum bilgisi kaydedilmesi için tarayıcınızdan konum iznine ihtiyacımız var.
                    <br />
                    Lütfen aşağıdaki butona tıklayın ve tarayıcı izin istediğinde <strong>"İzin Ver"</strong> seçeneğini seçin.
                  </p>
                  <button
                    onClick={requestLocationPermission}
                    className="flex items-center gap-2 px-5 py-2.5 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 text-sm font-medium shadow-sm"
                  >
                    <Navigation className="w-4 h-4" />
                    Konum İznini Aç
                  </button>
                </div>
              </div>
            </div>
          )}

          {locationPermission === 'granted' && (
            <div className="bg-green-50 border border-green-300 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <span className="text-sm text-green-800 font-medium">
                  ✅ Konum erişimi aktif - Teslimatlar konum bilgisiyle kaydedilecek
                </span>
              </div>
            </div>
          )}

          {/* Delivery Scanner */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <QrCode className="w-5 h-5 text-green-600" />
              Teslimat Barkodunu Tara
            </h2>
            <div className="flex gap-3">
              <input
                type="text"
                value={deliveryBarcodeInput}
                onChange={(e) => setDeliveryBarcodeInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleScanDeliveryBarcode()}
                placeholder="Teslimat barkodunu tarayın veya girin..."
                className="flex-1 px-4 py-3 text-lg border rounded-lg focus:ring-2 focus:ring-green-500 font-mono"
                autoFocus
              />
              <button
                onClick={handleScanDeliveryBarcode}
                className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
              >
                Bul
              </button>
            </div>
          </div>

          {/* Scanned Delivery Action */}
          {scannedDelivery && (
            <div className="bg-green-50 border-2 border-green-200 rounded-lg p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-green-900 mb-2 flex items-center gap-2">
                    <Navigation className="w-5 h-5" />
                    Teslim Edilmeye Hazır
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-green-700">Barkod:</span>
                      <span className="font-mono font-bold text-xl">{scannedDelivery.barcode}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-green-700">Otel:</span>
                      <span className="font-medium">{scannedDelivery.tenant?.name}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-green-700">Ürünler:</span>
                      <span className="font-medium">{scannedDelivery.deliveryItems?.length || 0}</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setScannedDelivery(null)}
                    className="px-4 py-2 border border-green-300 text-green-700 rounded-lg hover:bg-green-100"
                  >
                    İptal
                  </button>
                  <button
                    onClick={() => deliverMutation.mutate(scannedDelivery.id)}
                    disabled={deliverMutation.isPending}
                    className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    <CheckCircle className="w-5 h-5" />
                    {deliverMutation.isPending ? 'İşleniyor...' : 'Teslimatı Onayla'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Deliveries List */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Truck className="w-5 h-5 text-cyan-600" />
                Teslimat İçin Hazır ({inTransit.length})
              </h2>
            </div>
            {loadingInTransit ? (
              <div className="flex items-center justify-center h-48">
                <RefreshCw className="w-8 h-8 animate-spin text-cyan-500" />
              </div>
            ) : inTransit.length === 0 ? (
              <div className="p-12 text-center">
                <Truck className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                <p className="text-xl text-gray-500">Teslimat için paket yok</p>
                <p className="text-gray-400 mt-2">Önce paketleri tarayın</p>
              </div>
            ) : (
              <div className="divide-y">
                {inTransit.map(delivery => (
                  <div key={delivery.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <span className="font-mono font-bold">{delivery.barcode}</span>
                          <span className="px-2 py-0.5 rounded text-xs bg-cyan-100 text-cyan-800">
                            Yolda
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 flex items-center gap-1">
                          <MapPin className="w-4 h-4" />
                          {delivery.tenant?.name}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {delivery.packageCount} paket • {delivery.deliveryItems?.length || 0} ürün
                        </p>
                      </div>
                      <button
                        onClick={() => deliverMutation.mutate(delivery.id)}
                        disabled={deliverMutation.isPending}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                      >
                        <CheckCircle className="w-4 h-4" />
                        Teslim Et
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Driver Selection Dialog */}
      {showDriverSelection && <DriverSelectionDialog />}
    </div>
  );
}
