import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package, Truck, Printer, CheckCircle, XCircle,
  RefreshCw, Filter, ChevronRight
} from 'lucide-react';
import { deliveriesApi, settingsApi, itemsApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import type { Delivery, DeliveryStatus } from '../types';

const statusColors: Record<DeliveryStatus, string> = {
  created: 'bg-gray-100 text-gray-800',
  label_printed: 'bg-purple-100 text-purple-800',
  packaged: 'bg-indigo-100 text-indigo-800',
  picked_up: 'bg-cyan-100 text-cyan-800',
  delivered: 'bg-green-100 text-green-800',
};

const statusLabels: Record<DeliveryStatus, string> = {
  created: 'Created',
  label_printed: 'Label Printed',
  packaged: 'Packaged',
  picked_up: 'Picked Up',
  delivered: 'Delivered',
};

export function DeliveryManagementPage() {
  const [filter, setFilter] = useState<{ status?: string }>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['deliveries', filter],
    queryFn: () => deliveriesApi.getAll(filter),
  });

  const printLabelMutation = useMutation({
    mutationFn: deliveriesApi.printLabel,
    onSuccess: () => {
      toast.success('Label printed');
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
    },
    onError: (err) => toast.error('Failed to print label', getErrorMessage(err)),
  });

  const packageMutation = useMutation({
    mutationFn: deliveriesApi.package,
    onSuccess: () => {
      toast.success('Delivery packaged');
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
    },
    onError: (err) => toast.error('Failed to package', getErrorMessage(err)),
  });

  const pickupMutation = useMutation({
    mutationFn: deliveriesApi.pickup,
    onSuccess: () => {
      toast.success('Delivery picked up');
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
    },
    onError: (err) => toast.error('Failed to pickup', getErrorMessage(err)),
  });

  const deliverMutation = useMutation({
    mutationFn: deliveriesApi.deliver,
    onSuccess: () => {
      toast.success('Delivery completed');
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
    onError: (err) => toast.error('Failed to complete delivery', getErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: deliveriesApi.cancel,
    onSuccess: () => {
      toast.success('Delivery cancelled');
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
    },
    onError: (err) => toast.error('Failed to cancel', getErrorMessage(err)),
  });

  const deliveries = data?.data || [];

  const getNextAction = (delivery: Delivery) => {
    switch (delivery.status) {
      case 'created':
        return { label: 'Print Label', action: () => printLabelMutation.mutate(delivery.id), icon: Printer };
      case 'label_printed':
        return { label: 'Package', action: () => packageMutation.mutate(delivery.id), icon: Package };
      case 'packaged':
        return { label: 'Pickup', action: () => pickupMutation.mutate(delivery.id), icon: Truck };
      case 'picked_up':
        return { label: 'Deliver', action: () => deliverMutation.mutate(delivery.id), icon: CheckCircle };
      default:
        return null;
    }
  };

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Delivery Management</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Package className="w-4 h-4" />
            Create Delivery
          </button>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 flex items-center gap-4 flex-wrap">
        <Filter className="w-4 h-4 text-gray-500" />
        <select
          value={filter.status || ''}
          onChange={(e) => setFilter({ status: e.target.value || undefined })}
          className="px-3 py-1 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Statuses</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {/* Deliveries List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : deliveries.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <Package className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-500">No deliveries found</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Barcode</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Hotel</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Items</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Created</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {deliveries.map((delivery) => {
                const nextAction = getNextAction(delivery);
                return (
                  <tr key={delivery.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-sm">{delivery.barcode}</td>
                    <td className="px-4 py-3">{delivery.tenant?.name || '-'}</td>
                    <td className="px-4 py-3">{delivery.deliveryItems?.length || 0}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs rounded-full ${statusColors[delivery.status]}`}>
                        {statusLabels[delivery.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(delivery.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {nextAction && (
                          <button
                            onClick={nextAction.action}
                            className="flex items-center gap-1 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                          >
                            <nextAction.icon className="w-4 h-4" />
                            {nextAction.label}
                          </button>
                        )}
                        {delivery.status !== 'delivered' && (
                          <button
                            onClick={() => cancelMutation.mutate(delivery.id)}
                            className="p-1 text-red-500 hover:bg-red-50 rounded"
                            title="Cancel"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => setSelectedDelivery(delivery)}
                          className="p-1 text-gray-500 hover:bg-gray-100 rounded"
                          title="Details"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Delivery Modal */}
      {showCreateModal && (
        <CreateDeliveryModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            refetch();
          }}
        />
      )}

      {/* Delivery Details Modal */}
      {selectedDelivery && (
        <DeliveryDetailsModal
          delivery={selectedDelivery}
          onClose={() => setSelectedDelivery(null)}
        />
      )}
    </div>
  );
}

function CreateDeliveryModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [tenantId, setTenantId] = useState('');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const toast = useToast();

  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: settingsApi.getTenants,
  });

  const { data: readyItems, isLoading: loadingItems } = useQuery({
    queryKey: ['ready-items', tenantId],
    queryFn: () => itemsApi.getReady(tenantId || undefined),
    enabled: !!tenantId,
  });

  const createMutation = useMutation({
    mutationFn: deliveriesApi.create,
    onSuccess: () => {
      toast.success('Delivery created');
      onSuccess();
    },
    onError: (err) => toast.error('Failed to create delivery', getErrorMessage(err)),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || selectedItems.length === 0) {
      toast.warning('Select a hotel and at least one item');
      return;
    }
    createMutation.mutate({ tenantId, itemIds: selectedItems, notes, packageCount: 1 });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold">Create Delivery</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Hotel</label>
            <select
              value={tenantId}
              onChange={(e) => {
                setTenantId(e.target.value);
                setSelectedItems([]);
              }}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Select hotel...</option>
              {tenants?.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {tenantId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Items Ready for Delivery ({readyItems?.length || 0} available)
              </label>
              {loadingItems ? (
                <p className="text-gray-500">Loading items...</p>
              ) : readyItems && readyItems.length > 0 ? (
                <div className="border rounded-lg max-h-48 overflow-y-auto">
                  {readyItems.map(item => (
                    <label key={item.id} className="flex items-center gap-2 p-2 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedItems.includes(item.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedItems([...selectedItems, item.id]);
                          } else {
                            setSelectedItems(selectedItems.filter(id => id !== item.id));
                          }
                        }}
                        className="rounded border-gray-300 text-blue-600"
                      />
                      <span className="font-mono text-sm">{item.rfidTag}</span>
                      <span className="text-sm text-gray-500">{item.itemType?.name}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500">No items ready for delivery</p>
              )}
              <p className="text-sm text-gray-500 mt-1">{selectedItems.length} items selected</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 border rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || selectedItems.length === 0}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating...' : 'Create Delivery'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeliveryDetailsModal({ delivery, onClose }: { delivery: Delivery; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
        <div className="p-6 border-b flex items-center justify-between">
          <h2 className="text-xl font-bold">Delivery Details</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <XCircle className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Barcode</p>
              <p className="font-mono font-medium">{delivery.barcode}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Status</p>
              <span className={`px-2 py-1 text-xs rounded-full ${statusColors[delivery.status]}`}>
                {statusLabels[delivery.status]}
              </span>
            </div>
            <div>
              <p className="text-sm text-gray-500">Hotel</p>
              <p className="font-medium">{delivery.tenant?.name || '-'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Items</p>
              <p className="font-medium">{delivery.deliveryItems?.length || 0}</p>
            </div>
          </div>

          {delivery.deliveryItems && delivery.deliveryItems.length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-2">Items in Delivery</p>
              <div className="border rounded-lg max-h-48 overflow-y-auto">
                {delivery.deliveryItems.map(di => (
                  <div key={di.id} className="flex items-center justify-between p-2 border-b last:border-b-0">
                    <span className="font-mono text-sm">{di.item?.rfidTag}</span>
                    <span className="text-sm text-gray-500">{di.item?.itemType?.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {delivery.notes && (
            <div>
              <p className="text-sm text-gray-500">Notes</p>
              <p>{delivery.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
