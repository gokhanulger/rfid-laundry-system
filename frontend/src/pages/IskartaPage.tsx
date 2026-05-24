import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Ban, Loader2, RotateCcw, Search, Building2 } from 'lucide-react';
import { itemsApi, settingsApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import type { Item, Tenant } from '../types';

export function IskartaPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [search, setSearch] = useState('');

  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: settingsApi.getTenants,
    staleTime: 5 * 60 * 1000,
  });

  const { data: discarded, isLoading } = useQuery({
    queryKey: ['discarded-items', selectedTenantId],
    queryFn: () => itemsApi.getDiscarded(selectedTenantId || undefined),
  });

  const undiscardMutation = useMutation({
    mutationFn: (id: string) => itemsApi.undiscard(id),
    onSuccess: () => {
      toast.success('Urun iskartadan geri alindi');
      queryClient.invalidateQueries({ queryKey: ['discarded-items'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
    onError: (err) => toast.error('Geri alma basarisiz', getErrorMessage(err)),
  });

  // Arama filtresi (RFID / tur)
  const filtered = useMemo(() => {
    const list = discarded || [];
    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter((i: Item) =>
      i.rfidTag.toLowerCase().includes(term) ||
      (i.itemType?.name || '').toLowerCase().includes(term)
    );
  }, [discarded, search]);

  // Otel bazinda grupla
  const grouped = useMemo(() => {
    return filtered.reduce((acc: Record<string, { tenant?: Tenant; items: Item[] }>, item: Item) => {
      const key = item.tenantId;
      if (!acc[key]) acc[key] = { tenant: item.tenant, items: [] };
      acc[key].items.push(item);
      return acc;
    }, {} as Record<string, { tenant?: Tenant; items: Item[] }>);
  }, [filtered]);

  const totalCount = filtered.length;

  return (
    <div className="p-4 md:p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Ban className="w-7 h-7 text-red-600" />
          Iskarta Urunler
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Utucu tarafindan ayrilan, aktif stok ve teslimat disi birakilan urunler.
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6 p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="RFID veya tur ara..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
            />
          </div>
          <div className="md:w-64">
            <select
              value={selectedTenantId}
              onChange={(e) => setSelectedTenantId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-500"
            >
              <option value="">Tum oteller</option>
              {(tenants || []).map((t: Tenant) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-3">
          Toplam <span className="font-bold text-red-600">{totalCount}</span> iskarta urun
        </p>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="p-8 text-center bg-white rounded-xl border border-gray-100">
          <Loader2 className="w-8 h-8 animate-spin text-red-600 mx-auto" />
          <p className="mt-2 text-gray-500">Yukleniyor...</p>
        </div>
      ) : totalCount === 0 ? (
        <div className="p-8 text-center bg-white rounded-xl border border-gray-100">
          <Ban className="w-12 h-12 text-gray-300 mx-auto" />
          <p className="mt-2 text-gray-500">Iskarta urun bulunamadi</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.values(grouped).map((group) => (
            <div key={group.tenant?.id || 'unknown'} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 bg-red-50 border-b border-red-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-red-600" />
                  {group.tenant?.name || 'Bilinmeyen Otel'}
                </h3>
                <span className="text-sm font-medium text-red-700">{group.items.length} adet</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-100">
                      <th className="px-4 py-3 font-medium">Tur</th>
                      <th className="px-4 py-3 font-medium">RFID Tag</th>
                      <th className="px-4 py-3 font-medium">Iskarta Tarihi</th>
                      <th className="px-4 py-3 font-medium">Neden</th>
                      <th className="px-4 py-3 font-medium text-right">Islem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {group.items.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{item.itemType?.name || '-'}</td>
                        <td className="px-4 py-3 font-mono text-gray-600 break-all">{item.rfidTag}</td>
                        <td className="px-4 py-3 text-gray-600">
                          {item.discardedAt ? format(new Date(item.discardedAt), 'dd MMM yyyy HH:mm', { locale: tr }) : '-'}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{item.discardedReason || '-'}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => undiscardMutation.mutate(item.id)}
                            disabled={undiscardMutation.isPending}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                            title="Iskartadan geri al"
                          >
                            <RotateCcw className="w-4 h-4" />
                            Geri al
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
