import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi, tenantPricingApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import { DollarSign, Save, Building2, RefreshCw } from 'lucide-react';
import type { Tenant, ItemType } from '../types';

export function TenantPricingPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch tenants
  const { data: tenants = [], isLoading: tenantsLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: settingsApi.getTenants,
  });

  // Fetch item types
  const { data: itemTypes = [], isLoading: itemTypesLoading } = useQuery({
    queryKey: ['itemTypes'],
    queryFn: settingsApi.getItemTypes,
  });

  // Fetch prices for selected tenant
  const { data: tenantPrices = [], isLoading: pricesLoading, refetch: refetchPrices } = useQuery({
    queryKey: ['tenantPricing', selectedTenantId],
    queryFn: () => tenantPricingApi.getPrices(selectedTenantId),
    enabled: !!selectedTenantId,
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const priceList = Object.entries(prices)
        .filter(([_, val]) => val !== '' && parseFloat(val) >= 0)
        .map(([itemTypeId, val]) => ({
          itemTypeId,
          price: parseFloat(val),
        }));

      return tenantPricingApi.setBulkPrices(selectedTenantId, priceList);
    },
    onSuccess: () => {
      toast.success('Fiyatlar kaydedildi');
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: ['tenantPricing', selectedTenantId] });
    },
    onError: (err) => {
      toast.error('Kayit hatasi', getErrorMessage(err));
    },
  });

  // When tenant changes, load prices
  const handleTenantChange = (tenantId: string) => {
    setSelectedTenantId(tenantId);
    setHasChanges(false);
    setPrices({});
  };

  // When prices load, populate the form
  const populatePrices = () => {
    const priceMap: Record<string, string> = {};
    // Set all item types to empty first
    for (const it of itemTypes) {
      priceMap[it.id] = '';
    }
    // Fill in existing prices
    for (const tp of tenantPrices) {
      priceMap[tp.itemTypeId] = tp.price.toString();
    }
    setPrices(priceMap);
  };

  // Populate prices when data loads
  if (selectedTenantId && tenantPrices.length >= 0 && itemTypes.length > 0 && Object.keys(prices).length === 0 && !pricesLoading) {
    populatePrices();
  }

  const handlePriceChange = (itemTypeId: string, value: string) => {
    // Only allow numbers and decimal point
    if (value !== '' && !/^\d*\.?\d{0,2}$/.test(value)) return;
    setPrices(prev => ({ ...prev, [itemTypeId]: value }));
    setHasChanges(true);
  };

  // Copy prices from another tenant
  const [copyFromTenantId, setCopyFromTenantId] = useState<string>('');
  const copyMutation = useMutation({
    mutationFn: async () => {
      return tenantPricingApi.getPrices(copyFromTenantId);
    },
    onSuccess: (data) => {
      const priceMap: Record<string, string> = { ...prices };
      for (const tp of data) {
        priceMap[tp.itemTypeId] = tp.price.toString();
      }
      setPrices(priceMap);
      setHasChanges(true);
      setCopyFromTenantId('');
      toast.success('Fiyatlar kopyalandi', `${data.length} fiyat aktarildi`);
    },
    onError: (err) => {
      toast.error('Kopyalama hatasi', getErrorMessage(err));
    },
  });

  const selectedTenant = tenants.find((t: Tenant) => t.id === selectedTenantId);
  const globalItemTypes = itemTypes.filter((it: ItemType) => !it.tenantId);

  const filledCount = Object.values(prices).filter(v => v !== '' && parseFloat(v) > 0).length;
  const totalPrice = Object.entries(prices).reduce((sum, [_, val]) => {
    const v = parseFloat(val);
    return sum + (isNaN(v) ? 0 : v);
  }, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <DollarSign className="h-7 w-7 text-teal-600" />
            Otel Fiyat Yonetimi
          </h1>
          <p className="text-gray-500 mt-1">Her otel icin stok birim fiyatlarini belirleyin</p>
        </div>
      </div>

      {/* Tenant Selection */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[250px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Otel Secin</label>
            <select
              value={selectedTenantId}
              onChange={(e) => handleTenantChange(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            >
              <option value="">-- Otel secin --</option>
              {tenants.filter((t: Tenant) => t.isActive).map((t: Tenant) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {selectedTenantId && (
            <>
              <div className="min-w-[250px]">
                <label className="block text-sm font-medium text-gray-700 mb-1">Baska Otelden Kopyala</label>
                <div className="flex gap-2">
                  <select
                    value={copyFromTenantId}
                    onChange={(e) => setCopyFromTenantId(e.target.value)}
                    className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">-- Kaynak otel --</option>
                    {tenants.filter((t: Tenant) => t.isActive && t.id !== selectedTenantId).map((t: Tenant) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => copyMutation.mutate()}
                    disabled={!copyFromTenantId || copyMutation.isPending}
                    className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                  >
                    Kopyala
                  </button>
                </div>
              </div>

              <button
                onClick={() => refetchPrices()}
                className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                title="Yenile"
              >
                <RefreshCw className="h-5 w-5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Pricing Table */}
      {selectedTenantId && (
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="p-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Building2 className="h-5 w-5 text-teal-600" />
              <h2 className="font-semibold text-lg">{selectedTenant?.name}</h2>
              <span className="text-sm text-gray-500">
                {filledCount} / {globalItemTypes.length} fiyat tanimli
              </span>
            </div>
            <div className="flex items-center gap-3">
              {hasChanges && (
                <span className="text-sm text-amber-600 font-medium">Kaydedilmemis degisiklikler var</span>
              )}
              <button
                onClick={() => saveMutation.mutate()}
                disabled={!hasChanges || saveMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="h-4 w-4" />
                {saveMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>

          {pricesLoading || itemTypesLoading ? (
            <div className="p-8 text-center text-gray-500">Yukleniyor...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 w-12">#</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Urun Turu</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 w-40">Birim Fiyat (TL)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {globalItemTypes.map((it: ItemType, index: number) => {
                    const currentPrice = prices[it.id] || '';
                    const hasPrice = currentPrice !== '' && parseFloat(currentPrice) > 0;
                    return (
                      <tr
                        key={it.id}
                        className={`hover:bg-gray-50 ${hasPrice ? '' : 'bg-red-50/30'}`}
                      >
                        <td className="px-4 py-2 text-sm text-gray-400">{index + 1}</td>
                        <td className="px-4 py-2">
                          <span className="font-medium text-gray-900">{it.name}</span>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={currentPrice}
                              onChange={(e) => handlePriceChange(it.id, e.target.value)}
                              placeholder="0.00"
                              className="w-28 px-3 py-1.5 border rounded-lg text-right focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                            />
                            <span className="text-sm text-gray-400">TL</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 font-semibold">
                    <td className="px-4 py-3" colSpan={2}>
                      Toplam (tum birim fiyatlar)
                    </td>
                    <td className="px-4 py-3 text-right">
                      {totalPrice.toFixed(2)} TL
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {!selectedTenantId && !tenantsLoading && (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center text-gray-400">
          <DollarSign className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>Fiyat tanimlamak icin bir otel secin</p>
        </div>
      )}
    </div>
  );
}
