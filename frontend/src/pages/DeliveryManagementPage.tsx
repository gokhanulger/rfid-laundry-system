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
  created: 'Olusturuldu',
  label_printed: 'Etiket Yazdirildi',
  packaged: 'Paketlendi',
  picked_up: 'Teslim Alindi',
  delivered: 'Teslim Edildi',
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
      toast.success('Etiket yazdirildi');
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
    },
    onError: (err) => toast.error('Etiket yazdirilamadi', getErrorMessage(err)),
  });

  const packageMutation = useMutation({
    mutationFn: deliveriesApi.package,
    onSuccess: () => {
      toast.success('Teslimat paketlendi');
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
    },
    onError: (err) => toast.error('Paketleme basarisiz', getErrorMessage(err)),
  });

  const pickupMutation = useMutation({
    mutationFn: deliveriesApi.pickup,
    onSuccess: () => {
      toast.success('Teslimat alindi');
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
    },
    onError: (err) => toast.error('Teslim alma basarisiz', getErrorMessage(err)),
  });

  const deliverMutation = useMutation({
    mutationFn: (id: string) => deliveriesApi.deliver(id),
    onSuccess: () => {
      toast.success('Teslimat tamamlandi');
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
    onError: (err) => toast.error('Teslimat tamamlanamadi', getErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: deliveriesApi.cancel,
    onSuccess: () => {
      toast.success('Teslimat iptal edildi');
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
    },
    onError: (err) => toast.error('Iptal basarisiz', getErrorMessage(err)),
  });

  const deliveries = data?.data || [];

  const getNextAction = (delivery: Delivery) => {
    switch (delivery.status) {
      case 'created':
        return { label: 'Etiket Yazdir', action: () => printLabelMutation.mutate(delivery.id), icon: Printer };
      case 'label_printed':
        return { label: 'Paketle', action: () => packageMutation.mutate(delivery.id), icon: Package };
      case 'packaged':
        return { label: 'Teslim Al', action: () => pickupMutation.mutate(delivery.id), icon: Truck };
      case 'picked_up':
        return { label: 'Teslim Et', action: () => deliverMutation.mutate(delivery.id), icon: CheckCircle };
      default:
        return null;
    }
  };

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Teslimat Yonetimi</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Package className="w-4 h-4" />
            Teslimat Olustur
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
          <option value="">Tum Durumlar</option>
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
          <p className="text-gray-500">Teslimat bulunamadi</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Barkod</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Otel</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Urunler</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Durum</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Olusturma</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Islemler</th>
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
                            title="Iptal"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => setSelectedDelivery(delivery)}
                          className="p-1 text-gray-500 hover:bg-gray-100 rounded"
                          title="Detaylar"
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
      toast.success('Teslimat olusturuldu');
      onSuccess();
    },
    onError: (err) => toast.error('Teslimat olusturulamadi', getErrorMessage(err)),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || selectedItems.length === 0) {
      toast.warning('Bir otel ve en az bir urun secin');
      return;
    }
    createMutation.mutate({ tenantId, itemIds: selectedItems, notes, packageCount: 1 });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold">Teslimat Olustur</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Otel</label>
            <select
              value={tenantId}
              onChange={(e) => {
                setTenantId(e.target.value);
                setSelectedItems([]);
              }}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Otel secin...</option>
              {tenants?.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {tenantId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Teslimata Hazir Urunler ({readyItems?.length || 0} mevcut)
              </label>
              {loadingItems ? (
                <p className="text-gray-500">Urunler yukleniyor...</p>
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
                <p className="text-gray-500">Teslimata hazir urun yok</p>
              )}
              <p className="text-sm text-gray-500 mt-1">{selectedItems.length} urun secildi</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notlar (opsiyonel)</label>
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
              Iptal
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || selectedItems.length === 0}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {createMutation.isPending ? 'Olusturuluyor...' : 'Teslimat Olustur'}
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
          <h2 className="text-xl font-bold">Teslimat Detaylari</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <XCircle className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Barkod</p>
              <p className="font-mono font-medium">{delivery.barcode}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Durum</p>
              <span className={`px-2 py-1 text-xs rounded-full ${statusColors[delivery.status]}`}>
                {statusLabels[delivery.status]}
              </span>
            </div>
            <div>
              <p className="text-sm text-gray-500">Otel</p>
              <p className="font-medium">{delivery.tenant?.name || '-'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Urunler</p>
              <p className="font-medium">{delivery.deliveryItems?.length || 0}</p>
            </div>
          </div>

          {delivery.deliveryItems && delivery.deliveryItems.length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-2">Teslimattaki Urunler</p>
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
              <p className="text-sm text-gray-500">Notlar</p>
              <p>{delivery.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
