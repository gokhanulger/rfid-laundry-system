import { useQuery } from '@tanstack/react-query';
import { MapPin, Navigation, Clock, User, Package, Map as MapIcon } from 'lucide-react';
import { deliveriesApi } from '../lib/api';
import type { Delivery } from '../types';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Icon } from 'leaflet';

// Fix for default marker icon in react-leaflet
const defaultIcon = new Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

export function DeliveryLogsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['deliveries', { status: 'delivered' }],
    queryFn: () => deliveriesApi.getAll({ status: 'delivered', limit: 100 }),
  });

  const deliveries = data?.data || [];
  const deliveriesWithLocation = deliveries.filter(
    (d: Delivery) => d.deliveryLatitude && d.deliveryLongitude
  );

  if (isLoading) {
    return (
      <div className="p-8">
        <p>Yükleniyor...</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-green-100 rounded-lg">
          <Navigation className="w-8 h-8 text-green-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Teslimat Logları</h1>
          <p className="text-gray-500">
            {deliveriesWithLocation.length} teslimat konum bilgisiyle tamamlandı
          </p>
        </div>
      </div>

      {/* Map View */}
      {deliveriesWithLocation.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="p-4 border-b bg-gray-50">
            <div className="flex items-center gap-2">
              <MapIcon className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-gray-900">Teslimat Haritası</h2>
              <span className="text-sm text-gray-500">
                ({deliveriesWithLocation.length} konum)
              </span>
            </div>
          </div>
          <div className="h-96 w-full">
            <MapContainer
              center={[
                parseFloat(deliveriesWithLocation[0].deliveryLatitude!),
                parseFloat(deliveriesWithLocation[0].deliveryLongitude!)
              ]}
              zoom={12}
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {deliveriesWithLocation.map((delivery: Delivery) => (
                <Marker
                  key={delivery.id}
                  position={[
                    parseFloat(delivery.deliveryLatitude!),
                    parseFloat(delivery.deliveryLongitude!)
                  ]}
                  icon={defaultIcon}
                >
                  <Popup>
                    <div className="p-2">
                      <p className="font-bold font-mono text-sm mb-1">{delivery.barcode}</p>
                      <p className="text-sm text-gray-700 mb-1">
                        <strong>Otel:</strong> {delivery.tenant?.name}
                      </p>
                      <p className="text-sm text-gray-700 mb-1">
                        <strong>Sürücü:</strong> {delivery.driver?.firstName} {delivery.driver?.lastName}
                      </p>
                      <p className="text-xs text-gray-500">
                        {delivery.deliveredAt && new Date(delivery.deliveredAt).toLocaleString('tr-TR')}
                      </p>
                      {delivery.deliveryAddress && (
                        <p className="text-xs text-gray-600 mt-1">{delivery.deliveryAddress}</p>
                      )}
                      <a
                        href={`https://www.google.com/maps?q=${delivery.deliveryLatitude},${delivery.deliveryLongitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                      >
                        Google Maps'te Aç →
                      </a>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Barkod
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Otel
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Sürücü
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Teslimat Zamanı
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Konum
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {deliveriesWithLocation.map((delivery: Delivery) => (
              <tr key={delivery.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-gray-400" />
                    <span className="font-mono font-medium">{delivery.barcode}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-900">{delivery.tenant?.name}</span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-900">
                      {delivery.driver?.firstName} {delivery.driver?.lastName}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-500">
                      {delivery.deliveredAt &&
                        new Date(delivery.deliveredAt).toLocaleString('tr-TR')}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-green-600 mt-0.5" />
                    <div className="text-sm">
                      {delivery.deliveryAddress ? (
                        <p className="text-gray-900">{delivery.deliveryAddress}</p>
                      ) : null}
                      <a
                        href={`https://www.google.com/maps?q=${delivery.deliveryLatitude},${delivery.deliveryLongitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        {delivery.deliveryLatitude}, {delivery.deliveryLongitude}
                      </a>
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {deliveriesWithLocation.length === 0 && (
          <div className="p-12 text-center">
            <MapPin className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <p className="text-xl text-gray-500">Konum bilgisiyle teslimat yok</p>
          </div>
        )}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-3xl font-bold text-green-600">{deliveries.length}</p>
          <p className="text-sm text-gray-500">Toplam Teslimat</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-3xl font-bold text-blue-600">{deliveriesWithLocation.length}</p>
          <p className="text-sm text-gray-500">Konumlu Teslimat</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-3xl font-bold text-orange-600">
            {deliveries.length - deliveriesWithLocation.length}
          </p>
          <p className="text-sm text-gray-500">Konumsuz Teslimat</p>
        </div>
      </div>
    </div>
  );
}
