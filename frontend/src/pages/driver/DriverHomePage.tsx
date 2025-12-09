import { useNavigate } from 'react-router-dom';
import { ArrowUp, Truck, Package, Building2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { pickupsApi, deliveriesApi } from '../../lib/api';

export function DriverHomePage() {
  const navigate = useNavigate();

  // Get pending pickups count
  const { data: pendingPickups } = useQuery({
    queryKey: ['pickups', { status: 'pending' }],
    queryFn: () => pickupsApi.getAll({ status: 'pending', limit: 100 }),
  });

  // Get deliveries ready for pickup from laundry
  const { data: readyDeliveries } = useQuery({
    queryKey: ['deliveries', { status: 'packaged' }],
    queryFn: () => deliveriesApi.getAll({ status: 'packaged', limit: 100 }),
  });

  // Get deliveries in transit (ready for hotel delivery)
  const { data: inTransitDeliveries } = useQuery({
    queryKey: ['deliveries', { status: 'picked_up' }],
    queryFn: () => deliveriesApi.getAll({ status: 'picked_up', limit: 100 }),
  });

  const pickupCount = pendingPickups?.data?.length || 0;
  const laundryPickupCount = readyDeliveries?.data?.length || 0;
  const deliveryCount = inTransitDeliveries?.data?.length || 0;
  const totalDeliveryTasks = laundryPickupCount + deliveryCount;

  return (
    <div className="p-4 md:p-6 min-h-screen bg-gray-50">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">Şoför Paneli</h1>
        <p className="text-gray-500">Ne yapmak istiyorsunuz?</p>
      </div>

      {/* Main Action Cards */}
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Toplama Card - Kırmızı */}
        <button
          onClick={() => navigate('/driver/dirty-pickup')}
          className="w-full bg-gradient-to-br from-red-500 to-red-600 rounded-3xl p-6 md:p-8 text-white shadow-xl hover:shadow-2xl transform hover:scale-[1.02] active:scale-[0.98] transition-all touch-manipulation text-left"
        >
          <div className="flex items-center gap-4 md:gap-6">
            <div className="p-4 md:p-5 bg-white/20 rounded-2xl">
              <ArrowUp className="w-10 h-10 md:w-14 md:h-14" />
            </div>
            <div className="flex-1">
              <h2 className="text-2xl md:text-3xl font-bold mb-1">Toplama</h2>
              <p className="text-red-100 text-sm md:text-base">Otellerden kirli çamaşırları topla</p>
            </div>
            {pickupCount > 0 && (
              <div className="bg-white text-red-600 rounded-full w-12 h-12 md:w-16 md:h-16 flex items-center justify-center font-bold text-xl md:text-2xl shadow-lg">
                {pickupCount}
              </div>
            )}
          </div>

          {/* Sub info */}
          <div className="mt-4 pt-4 border-t border-white/20 flex items-center gap-4 text-red-100">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 md:w-5 md:h-5" />
              <span className="text-sm md:text-base">Otellerden kirli al</span>
            </div>
          </div>
        </button>

        {/* Teslim Etme Card */}
        <button
          onClick={() => navigate('/driver/delivery')}
          className="w-full bg-gradient-to-br from-green-500 to-green-600 rounded-3xl p-6 md:p-8 text-white shadow-xl hover:shadow-2xl transform hover:scale-[1.02] active:scale-[0.98] transition-all touch-manipulation text-left"
        >
          <div className="flex items-center gap-4 md:gap-6">
            <div className="p-4 md:p-5 bg-white/20 rounded-2xl">
              <Truck className="w-10 h-10 md:w-14 md:h-14" />
            </div>
            <div className="flex-1">
              <h2 className="text-2xl md:text-3xl font-bold mb-1">Teslim Etme</h2>
              <p className="text-green-100 text-sm md:text-base">Temiz çamaşırları otellere teslim et</p>
            </div>
            {totalDeliveryTasks > 0 && (
              <div className="bg-white text-green-600 rounded-full w-12 h-12 md:w-16 md:h-16 flex items-center justify-center font-bold text-xl md:text-2xl shadow-lg">
                {totalDeliveryTasks}
              </div>
            )}
          </div>

          {/* Sub info */}
          <div className="mt-4 pt-4 border-t border-white/20 grid grid-cols-2 gap-4 text-green-100">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 md:w-5 md:h-5" />
              <span className="text-sm md:text-base">{laundryPickupCount} paket hazır</span>
            </div>
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 md:w-5 md:h-5" />
              <span className="text-sm md:text-base">{deliveryCount} teslim bekliyor</span>
            </div>
          </div>
        </button>
      </div>

      {/* Quick Stats */}
      <div className="max-w-2xl mx-auto mt-8">
        <div className="bg-white rounded-2xl shadow-lg p-4 md:p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Bugünün Özeti</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-orange-50 rounded-xl">
              <p className="text-2xl md:text-3xl font-bold text-orange-600">{pickupCount}</p>
              <p className="text-xs md:text-sm text-gray-500">Bekleyen Toplama</p>
            </div>
            <div className="text-center p-3 bg-purple-50 rounded-xl">
              <p className="text-2xl md:text-3xl font-bold text-purple-600">{laundryPickupCount}</p>
              <p className="text-xs md:text-sm text-gray-500">Çamaşırhanede Hazır</p>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-xl">
              <p className="text-2xl md:text-3xl font-bold text-green-600">{deliveryCount}</p>
              <p className="text-xs md:text-sm text-gray-500">Teslim Edilecek</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
