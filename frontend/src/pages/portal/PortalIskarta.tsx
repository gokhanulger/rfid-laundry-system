import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import { Ban, Loader2, Search, ChevronLeft } from 'lucide-react';
import { itemsApi } from '../../lib/api';
import type { Item } from '../../types';

export function PortalIskarta() {
  const [search, setSearch] = useState('');

  const { data: discarded, isLoading } = useQuery({
    queryKey: ['portal', 'discarded-items'],
    queryFn: () => itemsApi.getDiscarded(), // backend otel kullanicisini kendi tenant'ina kisitlar
  });

  const filtered = useMemo(() => {
    const list = discarded || [];
    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter((i: Item) =>
      i.rfidTag.toLowerCase().includes(term) ||
      (i.itemType?.name || '').toLowerCase().includes(term)
    );
  }, [discarded, search]);

  // Tur bazinda ozet
  const byType = useMemo(() => {
    return filtered.reduce((acc: Record<string, number>, item: Item) => {
      const name = item.itemType?.name || 'Bilinmeyen';
      acc[name] = (acc[name] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [filtered]);

  return (
    <div className="p-4 md:p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="mb-6">
        <Link to="/portal" className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1 mb-2">
          <ChevronLeft className="w-4 h-4" /> Portal
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Ban className="w-7 h-7 text-red-600" />
          Iskarta Urunler
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Camasirhane tarafindan kullanim disi (iskarta) olarak ayrilan urunleriniz.
        </p>
      </div>

      {/* Tur ozeti */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {Object.entries(byType).map(([name, count]) => (
            <div key={name} className="bg-white rounded-xl border border-red-100 p-4">
              <p className="text-sm text-gray-500">{name}</p>
              <p className="text-2xl font-bold text-red-600">{count}</p>
            </div>
          ))}
        </div>
      )}

      {/* Arama */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="RFID veya tur ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
          />
        </div>
      </div>

      {/* Sonuclar */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        {isLoading ? (
          <div className="p-8 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-red-600 mx-auto" />
            <p className="mt-2 text-gray-500">Yukleniyor...</p>
          </div>
        ) : filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="px-4 py-3 font-medium">Tur</th>
                  <th className="px-4 py-3 font-medium">RFID Tag</th>
                  <th className="px-4 py-3 font-medium">Iskarta Tarihi</th>
                  <th className="px-4 py-3 font-medium">Neden</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{item.itemType?.name || '-'}</td>
                    <td className="px-4 py-3 font-mono text-gray-600 break-all">{item.rfidTag}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {item.discardedAt ? format(new Date(item.discardedAt), 'dd MMM yyyy HH:mm', { locale: tr }) : '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{item.discardedReason || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center">
            <Ban className="w-12 h-12 text-gray-300 mx-auto" />
            <p className="mt-2 text-gray-500">Iskarta urun bulunamadi</p>
          </div>
        )}
      </div>
    </div>
  );
}
