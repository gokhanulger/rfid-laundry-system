import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MapPin, CheckCircle, XCircle, AlertCircle, Navigation, Package } from 'lucide-react';
import { deliveriesApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';

export function LocationTestPage() {
  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string>('');
  const [apiRequest, setApiRequest] = useState<any>(null);
  const [apiResponse, setApiResponse] = useState<any>(null);
  const toast = useToast();

  // Get deliveries that can be delivered (picked_up status)
  const { data: deliveries } = useQuery({
    queryKey: ['deliveries', { status: 'picked_up' }],
    queryFn: () => deliveriesApi.getAll({ status: 'picked_up', limit: 10 }),
  });

  const testGeolocation = () => {
    setLocationStatus('loading');
    setLocationError(null);
    setLocation(null);

    if (!navigator.geolocation) {
      setLocationStatus('error');
      setLocationError('Geolocation is not supported by this browser');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setLocation(coords);
        setLocationStatus('success');
        toast.success(`Location captured: ${coords.latitude}, ${coords.longitude}`);
      },
      (error) => {
        setLocationStatus('error');
        let errorMsg = 'Unknown error';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMsg = 'User denied the request for Geolocation';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMsg = 'Location information is unavailable';
            break;
          case error.TIMEOUT:
            errorMsg = 'The request to get user location timed out';
            break;
        }
        setLocationError(errorMsg);
        toast.error(errorMsg);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  const deliverMutation = useMutation({
    mutationFn: async (deliveryId: string) => {
      if (!location) {
        throw new Error('No location data available');
      }
      // Log the request
      const requestData = {
        deliveryId,
        location,
        endpoint: `POST /api/deliveries/${deliveryId}/deliver`,
        timestamp: new Date().toISOString(),
      };
      setApiRequest(requestData);
      console.log('🚀 Sending delivery request:', requestData);

      const response = await deliveriesApi.deliver(deliveryId, location);

      // Log the response
      setApiResponse({
        data: response,
        timestamp: new Date().toISOString(),
      });
      console.log('✅ Delivery response:', response);

      return response;
    },
    onSuccess: (data) => {
      toast.success('Delivery completed with location!');
      console.log('📍 Location data in response:', {
        latitude: data.deliveryLatitude,
        longitude: data.deliveryLongitude,
        address: data.deliveryAddress,
      });
    },
    onError: (err) => {
      console.error('❌ Delivery error:', err);
      toast.error('Delivery failed', getErrorMessage(err));
      setApiResponse({
        error: getErrorMessage(err),
        timestamp: new Date().toISOString(),
      });
    },
  });

  const handleTestDelivery = () => {
    if (!selectedDeliveryId) {
      toast.error('Please select a delivery');
      return;
    }
    if (!location) {
      toast.error('Please capture location first');
      return;
    }
    deliverMutation.mutate(selectedDeliveryId);
  };

  const availableDeliveries = deliveries?.data || [];

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-3 bg-blue-100 rounded-lg">
          <Navigation className="w-8 h-8 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Location Test Page</h1>
          <p className="text-gray-500">Test geolocation and delivery with location tracking</p>
        </div>
      </div>

      {/* Browser Support Check */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-blue-600" />
          Browser Support
        </h2>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {navigator.geolocation ? (
              <>
                <CheckCircle className="w-5 h-5 text-green-600" />
                <span className="text-green-700 font-medium">Geolocation API is supported</span>
              </>
            ) : (
              <>
                <XCircle className="w-5 h-5 text-red-600" />
                <span className="text-red-700 font-medium">Geolocation API is NOT supported</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {window.isSecureContext ? (
              <>
                <CheckCircle className="w-5 h-5 text-green-600" />
                <span className="text-green-700 font-medium">Secure context (HTTPS)</span>
              </>
            ) : (
              <>
                <XCircle className="w-5 h-5 text-red-600" />
                <span className="text-red-700 font-medium">Not a secure context (HTTP)</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Test Geolocation */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <MapPin className="w-5 h-5 text-cyan-600" />
          Step 1: Test Geolocation
        </h2>

        <button
          onClick={testGeolocation}
          disabled={locationStatus === 'loading'}
          className="px-6 py-3 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 disabled:opacity-50 font-medium mb-4"
        >
          {locationStatus === 'loading' ? 'Getting Location...' : 'Get Current Location'}
        </button>

        {locationStatus === 'success' && location && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-start gap-2">
              <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
              <div>
                <p className="font-medium text-green-900">Location captured successfully!</p>
                <p className="text-sm text-green-700 mt-1">
                  Latitude: <span className="font-mono">{location.latitude}</span>
                </p>
                <p className="text-sm text-green-700">
                  Longitude: <span className="font-mono">{location.longitude}</span>
                </p>
                <a
                  href={`https://www.google.com/maps?q=${location.latitude},${location.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline mt-2 inline-block"
                >
                  View on Google Maps →
                </a>
              </div>
            </div>
          </div>
        )}

        {locationStatus === 'error' && locationError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start gap-2">
              <XCircle className="w-5 h-5 text-red-600 mt-0.5" />
              <div>
                <p className="font-medium text-red-900">Failed to get location</p>
                <p className="text-sm text-red-700 mt-1">{locationError}</p>
                <div className="mt-3 space-y-2 text-sm text-red-700">
                  <p className="font-medium">Troubleshooting:</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Make sure you allowed location access when prompted</li>
                    <li>Check browser settings for location permissions</li>
                    <li>Ensure you're on HTTPS (not HTTP)</li>
                    <li>Try refreshing the page and allowing permissions again</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Test Delivery with Location */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Package className="w-5 h-5 text-green-600" />
          Step 2: Test Delivery with Location
        </h2>

        {availableDeliveries.length === 0 ? (
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-yellow-800">
              No deliveries with "picked_up" status available to test.
              <br />
              <span className="text-sm">
                Go to Delivery Management and create a delivery, then progress it to "picked_up" status.
              </span>
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select a delivery to test:
              </label>
              <select
                value={selectedDeliveryId}
                onChange={(e) => setSelectedDeliveryId(e.target.value)}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-cyan-500"
              >
                <option value="">-- Select a delivery --</option>
                {availableDeliveries.map((delivery) => (
                  <option key={delivery.id} value={delivery.id}>
                    {delivery.barcode} - {delivery.tenant?.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleTestDelivery}
              disabled={!selectedDeliveryId || !location || deliverMutation.isPending}
              className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {deliverMutation.isPending ? 'Delivering...' : 'Complete Delivery with Location'}
            </button>

            {!location && (
              <p className="text-sm text-gray-500 mt-2">
                ⚠️ Please capture location first (Step 1)
              </p>
            )}
          </>
        )}
      </div>

      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-3 text-blue-900">How to Test:</h2>
        <ol className="list-decimal list-inside space-y-2 text-blue-800">
          <li>Click "Get Current Location" and allow browser permission when prompted</li>
          <li>Verify your location appears correctly</li>
          <li>Select a delivery from the dropdown (must have "picked_up" status)</li>
          <li>Click "Complete Delivery with Location"</li>
          <li>Go to "Teslimat Loglari" page to see the delivery with location data</li>
        </ol>
      </div>

      {/* API Request/Response Debug */}
      {(apiRequest || apiResponse) && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-3 text-purple-900">API Debug Info:</h2>

          {apiRequest && (
            <div className="mb-4">
              <p className="font-medium text-purple-900 mb-2">📤 Request Sent:</p>
              <pre className="bg-purple-100 p-3 rounded text-xs overflow-x-auto">
                {JSON.stringify(apiRequest, null, 2)}
              </pre>
            </div>
          )}

          {apiResponse && (
            <div>
              <p className="font-medium text-purple-900 mb-2">
                {apiResponse.error ? '❌ Error Response:' : '📥 Response Received:'}
              </p>
              <pre className="bg-purple-100 p-3 rounded text-xs overflow-x-auto">
                {JSON.stringify(apiResponse, null, 2)}
              </pre>

              {apiResponse.data && (
                <div className="mt-3 p-3 bg-purple-100 rounded">
                  <p className="font-medium text-purple-900 mb-2">📍 Location Data in Response:</p>
                  <div className="text-sm space-y-1">
                    <p>
                      <span className="font-medium">Latitude:</span>{' '}
                      <code>{apiResponse.data.deliveryLatitude || '❌ NOT SAVED'}</code>
                    </p>
                    <p>
                      <span className="font-medium">Longitude:</span>{' '}
                      <code>{apiResponse.data.deliveryLongitude || '❌ NOT SAVED'}</code>
                    </p>
                    <p>
                      <span className="font-medium">Address:</span>{' '}
                      <code>{apiResponse.data.deliveryAddress || 'N/A'}</code>
                    </p>
                  </div>

                  {!apiResponse.data.deliveryLatitude && (
                    <div className="mt-3 p-2 bg-red-100 border border-red-300 rounded">
                      <p className="text-red-800 font-medium text-sm">
                        ⚠️ Backend did not save location data!
                      </p>
                      <p className="text-red-700 text-xs mt-1">
                        This means the backend database schema hasn't been updated yet.
                        Railway deployment may still be in progress.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* API Endpoint Info */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-3 text-gray-900">API Information:</h2>
        <div className="space-y-2 text-sm text-gray-700">
          <p>
            <span className="font-medium">Frontend URL:</span>{' '}
            <code className="bg-gray-200 px-2 py-1 rounded">{window.location.origin}</code>
          </p>
          <p>
            <span className="font-medium">API Base URL:</span>{' '}
            <code className="bg-gray-200 px-2 py-1 rounded">
              {import.meta.env.VITE_API_URL || '/api'}
            </code>
          </p>
          <p>
            <span className="font-medium">Delivery Endpoint:</span>{' '}
            <code className="bg-gray-200 px-2 py-1 rounded">
              POST /api/deliveries/:id/deliver
            </code>
          </p>
        </div>
      </div>
    </div>
  );
}
