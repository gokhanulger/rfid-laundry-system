import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, RefreshCw, Package, Truck, CheckCircle, Clock } from 'lucide-react';
import api from '../lib/api';

interface HotelStatus {
  id: string;
  name: string;
  shortName: string;
  status: 'waiting' | 'collected' | 'packaged' | 'in_transit' | 'delivered';
  pendingItems: number;
  collectedItems: number;
  packagedItems: number;
  inTransitItems: number;
  deliveredItems: number;
  lastUpdate: string | null;
}

const statusColors: Record<string, { bg: string; border: string; text: string; label: string }> = {
  waiting: { bg: 'bg-gray-100', border: 'border-gray-300', text: 'text-gray-600', label: 'Beklemede' },
  collected: { bg: 'bg-red-500', border: 'border-red-600', text: 'text-white', label: 'Toplandi' },
  packaged: { bg: 'bg-yellow-400', border: 'border-yellow-500', text: 'text-yellow-900', label: 'Paketlendi' },
  in_transit: { bg: 'bg-green-500', border: 'border-green-600', text: 'text-white', label: 'Sevkiyatta' },
  delivered: { bg: 'bg-blue-500', border: 'border-blue-600', text: 'text-white', label: 'Teslim Edildi' },
};

export function HotelStatusBoardPage() {
  const [selectedHotel, setSelectedHotel] = useState<HotelStatus | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Fetch hotel statuses
  const { data: hotelStatuses, isLoading, refetch } = useQuery({
    queryKey: ['hotel-status-board'],
    queryFn: async () => {
      const res = await api.get('/dashboard/hotel-status-board');
      return res.data as HotelStatus[];
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Auto refresh
  useEffect(() => {
    const interval = setInterval(() => {
      refetch();
    }, 30000);
    return () => clearInterval(interval);
  }, [refetch]);

  const filteredHotels = hotelStatuses?.filter(hotel => {
    if (filterStatus === 'all') return true;
    return hotel.status === filterStatus;
  }) || [];

  const statusCounts = {
    all: hotelStatuses?.length || 0,
    waiting: hotelStatuses?.filter(h => h.status === 'waiting').length || 0,
    collected: hotelStatuses?.filter(h => h.status === 'collected').length || 0,
    packaged: hotelStatuses?.filter(h => h.status === 'packaged').length || 0,
    in_transit: hotelStatuses?.filter(h => h.status === 'in_transit').length || 0,
    delivered: hotelStatuses?.filter(h => h.status === 'delivered').length || 0,
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-100 rounded-lg">
            <Building2 className="w-8 h-8 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Otel Durum Panosu</h1>
            <p className="text-gray-500">Tum otellerin anlik durumu</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            Son guncelleme: {new Date().toLocaleTimeString('tr-TR')}
          </span>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            <RefreshCw className="w-4 h-4" />
            Yenile
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-6">
          <span className="text-sm font-medium text-gray-700">Durum Aciklamasi:</span>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gray-100 border-2 border-gray-300 rounded"></div>
            <span className="text-sm text-gray-600">Beklemede</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-red-500 border-2 border-red-600 rounded"></div>
            <span className="text-sm text-gray-600">Kirli Toplandi</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-yellow-400 border-2 border-yellow-500 rounded"></div>
            <span className="text-sm text-gray-600">Paketlendi</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-green-500 border-2 border-green-600 rounded"></div>
            <span className="text-sm text-gray-600">Sevkiyatta</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-blue-500 border-2 border-blue-600 rounded"></div>
            <span className="text-sm text-gray-600">Teslim Edildi</span>
          </div>
        </div>
      </div>

      {/* Filter Buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilterStatus('all')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            filterStatus === 'all'
              ? 'bg-indigo-600 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          Tumu ({statusCounts.all})
        </button>
        <button
          onClick={() => setFilterStatus('waiting')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            filterStatus === 'waiting'
              ? 'bg-gray-600 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          Beklemede ({statusCounts.waiting})
        </button>
        <button
          onClick={() => setFilterStatus('collected')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            filterStatus === 'collected'
              ? 'bg-red-500 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          Toplandi ({statusCounts.collected})
        </button>
        <button
          onClick={() => setFilterStatus('packaged')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            filterStatus === 'packaged'
              ? 'bg-yellow-500 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          Paketlendi ({statusCounts.packaged})
        </button>
        <button
          onClick={() => setFilterStatus('in_transit')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            filterStatus === 'in_transit'
              ? 'bg-green-500 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          Sevkiyatta ({statusCounts.in_transit})
        </button>
        <button
          onClick={() => setFilterStatus('delivered')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            filterStatus === 'delivered'
              ? 'bg-blue-500 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          Teslim Edildi ({statusCounts.delivered})
        </button>
      </div>

      {/* Hotel Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {filteredHotels.map((hotel) => {
              const colors = statusColors[hotel.status];
              return (
                <button
                  key={hotel.id}
                  onClick={() => setSelectedHotel(hotel)}
                  className={`
                    relative rounded-xl border-2 p-4
                    ${colors.bg} ${colors.border} ${colors.text}
                    hover:scale-105 hover:shadow-lg transition-all duration-200
                    flex flex-col items-center justify-center
                    cursor-pointer min-h-[100px]
                  `}
                  title={hotel.name}
                >
                  <span className="font-bold text-sm leading-tight text-center line-clamp-2">
                    {hotel.name}
                  </span>
                  <span className="text-xs mt-1 opacity-75">
                    {statusColors[hotel.status].label}
                  </span>
                  {hotel.pendingItems > 0 && (
                    <span className="absolute -top-2 -right-2 w-6 h-6 bg-orange-500 text-white text-xs rounded-full flex items-center justify-center font-bold shadow-md">
                      {hotel.pendingItems > 99 ? '99+' : hotel.pendingItems}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {filteredHotels.length === 0 && (
            <div className="text-center py-12">
              <Building2 className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500">Bu durumda otel bulunamadi</p>
            </div>
          )}
        </div>
      )}

      {/* Hotel Detail Modal */}
      {selectedHotel && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setSelectedHotel(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className={`p-6 rounded-t-xl ${statusColors[selectedHotel.status].bg}`}>
              <h2 className={`text-xl font-bold ${statusColors[selectedHotel.status].text}`}>
                {selectedHotel.name}
              </h2>
              <p className={`text-sm ${statusColors[selectedHotel.status].text} opacity-80`}>
                Durum: {statusColors[selectedHotel.status].label}
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg p-4 text-center">
                  <Clock className="w-6 h-6 mx-auto text-gray-400 mb-2" />
                  <p className="text-2xl font-bold text-gray-900">{selectedHotel.pendingItems}</p>
                  <p className="text-xs text-gray-500">Bekleyen</p>
                </div>
                <div className="bg-red-50 rounded-lg p-4 text-center">
                  <Truck className="w-6 h-6 mx-auto text-red-500 mb-2" />
                  <p className="text-2xl font-bold text-red-600">{selectedHotel.collectedItems}</p>
                  <p className="text-xs text-gray-500">Toplanan</p>
                </div>
                <div className="bg-yellow-50 rounded-lg p-4 text-center">
                  <Package className="w-6 h-6 mx-auto text-yellow-500 mb-2" />
                  <p className="text-2xl font-bold text-yellow-600">{selectedHotel.packagedItems}</p>
                  <p className="text-xs text-gray-500">Paketlenen</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-4 text-center">
                  <CheckCircle className="w-6 h-6 mx-auto text-blue-500 mb-2" />
                  <p className="text-2xl font-bold text-blue-600">{selectedHotel.deliveredItems}</p>
                  <p className="text-xs text-gray-500">Teslim Edilen</p>
                </div>
              </div>

              {selectedHotel.lastUpdate && (
                <p className="text-sm text-gray-500 text-center">
                  Son islem: {new Date(selectedHotel.lastUpdate).toLocaleString('tr-TR')}
                </p>
              )}

              <button
                onClick={() => setSelectedHotel(null)}
                className="w-full py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
