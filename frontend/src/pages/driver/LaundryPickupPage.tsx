import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Package, Building2, CheckCircle, RefreshCw, Truck, QrCode } from 'lucide-react';
import { deliveriesApi, getErrorMessage } from '../../lib/api';
import { useToast } from '../../components/Toast';
import type { Delivery } from '../../types';

export function LaundryPickupPage() {
  const [selectedDeliveries, setSelectedDeliveries] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const toast = useToast();

  // Get deliveries ready for pickup (packaged status)
  const { data: readyDeliveries, isLoading, refetch } = useQuery({
    queryKey: ['deliveries', { status: 'packaged' }],
    queryFn: () => deliveriesApi.getAll({ status: 'packaged', limit: 50 }),
  });

  const pickupMutation = useMutation({
    mutationFn: async (deliveryId: string) => {
      return deliveriesApi.pickup(deliveryId);
    },
    onSuccess: () => {
      toast.success('Delivery picked up successfully!');
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      setSelectedDeliveries([]);
      refetch();
    },
    onError: (err) => toast.error('Failed to pickup', getErrorMessage(err)),
  });

  const handlePickup = (deliveryId: string) => {
    pickupMutation.mutate(deliveryId);
  };

  const handlePickupAll = async () => {
    for (const id of selectedDeliveries) {
      await pickupMutation.mutateAsync(id);
    }
    setSelectedDeliveries([]);
  };

  const toggleSelection = (id: string) => {
    setSelectedDeliveries(prev =>
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
    );
  };

  const deliveriesList = readyDeliveries?.data || [];

  // Group by hotel
  const deliveriesByHotel = deliveriesList.reduce((acc: Record<string, Delivery[]>, delivery: Delivery) => {
    const hotelName = delivery.tenant?.name || 'Unknown';
    if (!acc[hotelName]) acc[hotelName] = [];
    acc[hotelName].push(delivery);
    return acc;
  }, {});

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 animate-fade-in min-h-screen bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 md:gap-4">
          <div className="p-3 md:p-4 bg-purple-100 rounded-xl">
            <Package className="w-8 h-8 md:w-10 md:h-10 text-purple-600" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Laundry Pickup</h1>
            <p className="text-sm md:text-base text-gray-500">Pick up clean packages from laundry</p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 md:p-3 text-gray-500 hover:bg-gray-100 active:bg-gray-200 rounded-xl touch-manipulation"
        >
          <RefreshCw className="w-5 h-5 md:w-6 md:h-6" />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 md:gap-4">
        <div className="bg-white rounded-xl shadow p-3 md:p-4">
          <p className="text-2xl md:text-4xl font-bold text-purple-600">{deliveriesList.length}</p>
          <p className="text-xs md:text-sm text-gray-500">Ready for Pickup</p>
        </div>
        <div className="bg-white rounded-xl shadow p-3 md:p-4">
          <p className="text-2xl md:text-4xl font-bold text-blue-600">{Object.keys(deliveriesByHotel).length}</p>
          <p className="text-xs md:text-sm text-gray-500">Hotels</p>
        </div>
        <div className="bg-white rounded-xl shadow p-3 md:p-4">
          <p className="text-2xl md:text-4xl font-bold text-green-600">{selectedDeliveries.length}</p>
          <p className="text-xs md:text-sm text-gray-500">Selected</p>
        </div>
      </div>

      {/* Bulk Action */}
      {selectedDeliveries.length > 0 && (
        <div className="bg-purple-600 text-white rounded-xl p-3 md:p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="font-bold text-base md:text-lg">
            {selectedDeliveries.length} package(s) selected
          </span>
          <button
            onClick={handlePickupAll}
            disabled={pickupMutation.isPending}
            className="w-full sm:w-auto px-4 md:px-6 py-3 bg-white text-purple-600 rounded-xl font-bold hover:bg-purple-50 active:bg-purple-100 flex items-center justify-center gap-2 touch-manipulation"
          >
            <Truck className="w-5 h-5" />
            Pickup All Selected
          </button>
        </div>
      )}

      {/* Deliveries by Hotel */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <RefreshCw className="w-10 h-10 animate-spin text-purple-500" />
        </div>
      ) : deliveriesList.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-lg p-8 md:p-16 text-center">
          <Package className="w-16 h-16 md:w-20 md:h-20 mx-auto text-gray-300 mb-4" />
          <p className="text-xl md:text-2xl font-semibold text-gray-500">No packages ready for pickup</p>
          <p className="text-sm md:text-base text-gray-400 mt-2">Check back later</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(deliveriesByHotel).map(([hotelName, hotelDeliveries]) => (
            <div key={hotelName} className="bg-white rounded-2xl shadow-lg overflow-hidden">
              {/* Hotel Header */}
              <div className="bg-gradient-to-r from-purple-600 to-purple-500 px-4 md:px-6 py-3 md:py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 md:gap-3 min-w-0">
                    <Building2 className="w-6 h-6 md:w-8 md:h-8 text-white flex-shrink-0" />
                    <div className="min-w-0">
                      <h3 className="text-lg md:text-xl font-bold text-white truncate">{hotelName}</h3>
                      <p className="text-purple-100 text-xs md:text-sm">{hotelDeliveries.length} package(s)</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const ids = hotelDeliveries.map(d => d.id);
                      const allSelected = ids.every(id => selectedDeliveries.includes(id));
                      if (allSelected) {
                        setSelectedDeliveries(prev => prev.filter(id => !ids.includes(id)));
                      } else {
                        setSelectedDeliveries(prev => [...new Set([...prev, ...ids])]);
                      }
                    }}
                    className="px-3 md:px-4 py-2 bg-white bg-opacity-20 text-white rounded-lg hover:bg-opacity-30 active:bg-opacity-40 text-sm md:text-base touch-manipulation flex-shrink-0"
                  >
                    {hotelDeliveries.every(d => selectedDeliveries.includes(d.id)) ? 'Deselect' : 'Select All'}
                  </button>
                </div>
              </div>

              {/* Deliveries */}
              <div className="divide-y">
                {hotelDeliveries.map((delivery) => (
                  <div
                    key={delivery.id}
                    className={`p-3 md:p-4 flex items-center justify-between transition-colors ${
                      selectedDeliveries.includes(delivery.id) ? 'bg-purple-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <label className="flex items-center gap-3 md:gap-4 flex-1 cursor-pointer min-w-0">
                      <input
                        type="checkbox"
                        checked={selectedDeliveries.includes(delivery.id)}
                        onChange={() => toggleSelection(delivery.id)}
                        className="w-5 h-5 md:w-6 md:h-6 text-purple-600 rounded focus:ring-purple-500 touch-manipulation"
                      />
                      <QrCode className="w-6 h-6 md:w-8 md:h-8 text-gray-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="font-mono font-bold text-sm md:text-lg truncate">{delivery.barcode}</p>
                        <div className="flex items-center gap-2 md:gap-4 text-xs md:text-sm text-gray-500">
                          <span>{delivery.deliveryItems?.length || 0} items</span>
                          <span>{delivery.packageCount || 1} pkg</span>
                        </div>
                      </div>
                    </label>
                    <button
                      onClick={() => handlePickup(delivery.id)}
                      disabled={pickupMutation.isPending}
                      className="px-3 md:px-4 py-2 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 active:bg-purple-800 disabled:bg-gray-400 flex items-center gap-1 md:gap-2 text-sm md:text-base touch-manipulation flex-shrink-0 ml-2"
                    >
                      <CheckCircle className="w-4 h-4 md:w-5 md:h-5" />
                      <span className="hidden sm:inline">Pickup</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
