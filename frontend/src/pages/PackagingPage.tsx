import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Package, CheckCircle, RefreshCw, QrCode, Box } from 'lucide-react';
import { deliveriesApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import type { Delivery } from '../types';

export function PackagingPage() {
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
        toast.success('Delivery found!');
      } else if (delivery.status === 'packaged') {
        toast.warning('This delivery is already packaged');
      } else {
        toast.warning(`Delivery status is "${delivery.status}" - cannot package`);
      }
      setBarcodeInput('');
    },
    onError: (err) => {
      toast.error('Delivery not found', getErrorMessage(err));
      setBarcodeInput('');
    },
  });

  const packageMutation = useMutation({
    mutationFn: deliveriesApi.package,
    onSuccess: () => {
      toast.success('Delivery packaged successfully!');
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      setScannedDelivery(null);
    },
    onError: (err) => toast.error('Failed to package', getErrorMessage(err)),
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
            <p className="text-gray-500">Scan labels and package deliveries</p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Barcode Scanner */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <QrCode className="w-5 h-5 text-indigo-600" />
          Scan Delivery Barcode
        </h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleScan()}
            placeholder="Scan or enter barcode..."
            className="flex-1 px-4 py-3 text-lg border rounded-lg focus:ring-2 focus:ring-indigo-500 font-mono"
            autoFocus
          />
          <button
            onClick={handleScan}
            disabled={scanMutation.isPending}
            className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
          >
            {scanMutation.isPending ? 'Scanning...' : 'Find'}
          </button>
        </div>
      </div>

      {/* Scanned Delivery - Package Confirmation */}
      {scannedDelivery && (
        <div className="bg-indigo-50 border-2 border-indigo-200 rounded-lg p-6">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-bold text-indigo-900 mb-2">Ready to Package</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-indigo-700">Barcode:</span>
                  <span className="font-mono font-bold text-xl">{scannedDelivery.barcode}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-indigo-700">Hotel:</span>
                  <span className="font-medium">{scannedDelivery.tenant?.name}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-indigo-700">Items:</span>
                  <span className="font-medium">{scannedDelivery.deliveryItems?.length || 0}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setScannedDelivery(null)}
                className="px-4 py-2 border border-indigo-300 text-indigo-700 rounded-lg hover:bg-indigo-100"
              >
                Cancel
              </button>
              <button
                onClick={() => handlePackage(scannedDelivery.id)}
                disabled={packageMutation.isPending}
                className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                <Box className="w-5 h-5" />
                {packageMutation.isPending ? 'Processing...' : 'Confirm Package'}
              </button>
            </div>
          </div>

          {/* Items List */}
          {scannedDelivery.deliveryItems && scannedDelivery.deliveryItems.length > 0 && (
            <div className="mt-4 pt-4 border-t border-indigo-200">
              <p className="text-sm text-indigo-700 mb-2">Items in this delivery:</p>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pending Packaging */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Box className="w-5 h-5 text-indigo-600" />
                Awaiting Packaging ({pendingDeliveries.length})
              </h2>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center h-48">
                <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
              </div>
            ) : pendingDeliveries.length === 0 ? (
              <div className="p-12 text-center">
                <Package className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                <p className="text-xl text-gray-500">No deliveries awaiting packaging</p>
                <p className="text-gray-400 mt-2">Print labels first</p>
              </div>
            ) : (
              <div className="divide-y">
                {pendingDeliveries.map(delivery => (
                  <div key={delivery.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <span className="font-mono font-bold">{delivery.barcode}</span>
                          <span className="px-2 py-0.5 bg-purple-100 text-purple-800 rounded text-xs">
                            Label Printed
                          </span>
                        </div>
                        <p className="text-sm text-gray-600">{delivery.tenant?.name}</p>
                        <p className="text-xs text-gray-400">
                          {delivery.deliveryItems?.length || 0} items
                        </p>
                      </div>
                      <button
                        onClick={() => handlePackage(delivery.id)}
                        disabled={packageMutation.isPending}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                      >
                        <Box className="w-4 h-4" />
                        Package
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recently Packaged */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              Recently Packaged
            </h2>
          </div>
          {recentPackaged.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              No recently packaged deliveries
            </div>
          ) : (
            <div className="divide-y">
              {recentPackaged.map(delivery => (
                <div key={delivery.id} className="p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono font-medium">{delivery.barcode}</span>
                    <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded-full text-xs">
                      Packaged
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">{delivery.tenant?.name}</p>
                  <p className="text-xs text-gray-400">
                    {delivery.packagedAt && new Date(delivery.packagedAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
