import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import { Shirt, Loader2, ChevronLeft, Send, CheckCircle2, Clock, X, Download, Search } from 'lucide-react';
import { portalApi, settingsApi, getErrorMessage, DirtyDeclaration } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../contexts/AuthContext';
import type { ItemType } from '../../types';

// Kirli beyana okunabilir bir irsaliye numarasi uret (gercek waybill numarasi yok)
function dirtyWaybillNo(d: DirtyDeclaration): string {
  return `K-${d.id.slice(0, 8).toUpperCase()}`;
}

export function PortalDirtyDelivery() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // itemTypeId -> girilen adet (string). Sadece adet girilenler gonderilir.
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<DirtyDeclaration | null>(null);

  const { data: itemTypes } = useQuery({
    queryKey: ['item-types'],
    queryFn: () => settingsApi.getItemTypes(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['portal', 'dirty-declarations'],
    queryFn: () => portalApi.getDirtyDeclarations({ limit: 50 }),
  });

  // Fis duzeni: tum urun tipleri sortOrder ile (API zaten sirali doner)
  const typesList: ItemType[] = useMemo(() => itemTypes || [], [itemTypes]);
  const filteredTypes = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('tr');
    if (!term) return typesList;
    return typesList.filter((t) => t.name.toLocaleLowerCase('tr').includes(term));
  }, [typesList, search]);

  const buildItems = () =>
    Object.entries(counts)
      .filter(([, c]) => parseInt(c) > 0)
      .map(([itemTypeId, c]) => ({ itemTypeId, count: parseInt(c) }));

  const createMutation = useMutation({
    mutationFn: () => portalApi.createDirtyDeclaration({ items: buildItems(), notes: notes.trim() || undefined }),
    onSuccess: () => {
      toast.success('Kirli teslim bildirildi', 'Camasirhane ekranina dustu.');
      setCounts({});
      setNotes('');
      setSearch('');
      queryClient.invalidateQueries({ queryKey: ['portal', 'dirty-declarations'] });
    },
    onError: (err) => toast.error('Bildirim basarisiz', getErrorMessage(err)),
  });

  const validEntries = Object.entries(counts).filter(([, c]) => parseInt(c) > 0);
  const totalCount = validEntries.reduce((sum, [, c]) => sum + parseInt(c || '0'), 0);

  const setCount = (id: string, val: string) => {
    const clean = val.replace(/[^0-9]/g, '');
    setCounts((prev) => ({ ...prev, [id]: clean }));
  };

  return (
    <div className="p-4 md:p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="mb-6">
        <Link to="/portal" className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1 mb-2">
          <ChevronLeft className="w-4 h-4" /> Portal
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Shirt className="w-7 h-7 text-orange-600" />
          Kirli Teslim
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Camasirhaneye gonderdiginiz kirli urunlerin tip ve adetlerini bildirin. Camasirhane bu beyani gorur.
        </p>
      </div>

      {/* Yeni beyan - TESLIM FISI (KIRLI) duzeni */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-8">
        {/* Fis basligi */}
        <div className="bg-orange-600 text-white px-4 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">TESLIM FISI (KIRLI)</h2>
            <p className="text-xs text-orange-100">{user?.tenantName || 'Otel'}</p>
          </div>
          <p className="text-sm">{format(new Date(), 'dd.MM.yyyy', { locale: tr })}</p>
        </div>

        {/* Arama (101 urun arasinda hizli bulma) */}
        <div className="p-3 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Urun ara (orn. carsaf, havlu...)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            />
          </div>
        </div>

        {/* Sutun basliklari */}
        <div className="grid grid-cols-[1fr_96px] bg-gray-100 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">
          <div className="px-4 py-2">Malin Cinsi</div>
          <div className="px-2 py-2 text-center border-l border-gray-200">Adet</div>
        </div>

        {/* Urun listesi - her satira adet girilir */}
        <div className="max-h-[55vh] overflow-y-auto divide-y divide-gray-100">
          {filteredTypes.map((t) => {
            const val = counts[t.id] || '';
            const has = parseInt(val) > 0;
            return (
              <div
                key={t.id}
                className={`grid grid-cols-[1fr_96px] items-center ${has ? 'bg-orange-50' : ''}`}
              >
                <label htmlFor={`cnt-${t.id}`} className="px-4 py-2 text-sm font-medium text-gray-800 cursor-text truncate">
                  {t.name}
                </label>
                <div className="px-2 py-1.5 border-l border-gray-100">
                  <input
                    id={`cnt-${t.id}`}
                    type="text"
                    inputMode="numeric"
                    value={val}
                    onChange={(e) => setCount(t.id, e.target.value)}
                    className={`w-full px-2 py-1.5 border rounded-md text-center text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 ${has ? 'border-orange-400 font-bold text-orange-700' : 'border-gray-200'}`}
                  />
                </div>
              </div>
            );
          })}
          {filteredTypes.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-gray-400">Urun bulunamadi</div>
          )}
        </div>

        {/* Not + gonder */}
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <label className="block text-sm font-medium text-gray-700 mb-1">Not (istege bagli)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Ornek: aceleli, lekeli urunler ayri torbada..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-none"
          />
          <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm text-gray-600">
              {validEntries.length > 0 ? `${validEntries.length} cins / toplam ${totalCount} adet` : 'Adet girdiginiz urunler gonderilir'}
            </span>
            <button
              onClick={() => createMutation.mutate()}
              disabled={validEntries.length === 0 || createMutation.isPending}
              className="flex items-center gap-2 px-5 py-2.5 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {createMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              Teslim Et
            </button>
          </div>
        </div>
      </div>

      {/* Gecmis */}
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Bildirim Gecmisi</h2>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        {historyLoading ? (
          <div className="p-8 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-orange-600 mx-auto" />
            <p className="mt-2 text-gray-500">Yukleniyor...</p>
          </div>
        ) : (history?.data?.length || 0) > 0 ? (
          <div className="divide-y divide-gray-100">
            {history!.data.map((d: DirtyDeclaration) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setSelected(d)}
                className="w-full text-left p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500">
                    <span className="font-mono text-gray-700 mr-2">{dirtyWaybillNo(d)}</span>
                    {format(new Date(d.createdAt), 'dd MMM yyyy HH:mm', { locale: tr })}
                  </span>
                  {d.status === 'processed' ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Islendi
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-full">
                      <Clock className="w-3.5 h-3.5" /> Beklemede
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {d.items.map((it) => (
                    <span key={it.itemTypeId} className="text-sm bg-gray-100 text-gray-700 px-2.5 py-1 rounded-lg">
                      {it.itemTypeName}: <span className="font-semibold">{it.count}</span>
                    </span>
                  ))}
                </div>
                {d.notes && <p className="mt-2 text-sm text-gray-500 italic">{d.notes}</p>}
              </button>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center">
            <Shirt className="w-12 h-12 text-gray-300 mx-auto" />
            <p className="mt-2 text-gray-500">Henuz kirli bildirimi yok</p>
          </div>
        )}
      </div>

      {/* Kirli Irsaliye Detay Modal - temiz irsaliye ile ayni PDF format */}
      {selected && (() => {
        const totalCount = selected.items.reduce((s, it) => s + it.count, 0);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                <h3 className="font-semibold text-gray-900">Kirli Irsaliye Detayi</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => window.print()}
                    className="flex items-center gap-1 px-3 py-1.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-sm"
                  >
                    <Download className="w-4 h-4" />
                    Yazdir / PDF
                  </button>
                  <button
                    onClick={() => setSelected(null)}
                    className="p-1 hover:bg-gray-200 rounded-lg"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* PDF Style Content */}
              <div className="p-6 overflow-y-auto max-h-[75vh] print:max-h-none print:overflow-visible" id="dirty-waybill-print">
                {/* Header */}
                <div className="text-center border-b-2 border-gray-800 pb-4 mb-4">
                  <h1 className="text-2xl font-bold text-gray-900">KIRLI IRSALIYE</h1>
                  <p className="text-lg font-mono mt-2">{dirtyWaybillNo(selected)}</p>
                </div>

                {/* Hotel & Date Info */}
                <div className="grid grid-cols-2 gap-6 mb-6">
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Otel</p>
                    <p className="font-semibold text-lg">{user?.tenantName || 'Otel'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 uppercase">Tarih</p>
                    <p className="font-semibold">
                      {format(new Date(selected.createdAt), 'dd MMMM yyyy', { locale: tr })}
                    </p>
                    <p className="text-sm text-gray-600">
                      {format(new Date(selected.createdAt), 'HH:mm', { locale: tr })}
                    </p>
                  </div>
                </div>

                {/* Summary Box */}
                <div className="bg-gray-100 rounded-lg p-4 mb-6">
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div>
                      <p className="text-2xl font-bold text-orange-600">{selected.items.length}</p>
                      <p className="text-xs text-gray-500">Urun Tipi</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-purple-600">{totalCount}</p>
                      <p className="text-xs text-gray-500">Toplam Adet</p>
                    </div>
                  </div>
                </div>

                {/* Item Details Table */}
                {selected.items.length > 0 && (
                  <div className="mb-6">
                    <h3 className="font-semibold text-gray-900 mb-3 border-b pb-2">Urun Detaylari</h3>
                    <table className="w-full">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="text-left px-3 py-2 font-medium text-gray-700">Urun Tipi</th>
                          <th className="text-right px-3 py-2 font-medium text-gray-700">Adet</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.items.map((item) => (
                          <tr key={item.itemTypeId} className="border-b border-gray-100">
                            <td className="px-3 py-2">{item.itemTypeName || '-'}</td>
                            <td className="px-3 py-2 text-right font-semibold">{item.count || 0}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-gray-50 font-bold">
                          <td className="px-3 py-2">TOPLAM</td>
                          <td className="px-3 py-2 text-right">{totalCount}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {/* Not */}
                {selected.notes && (
                  <div className="mb-6">
                    <p className="text-xs text-gray-500 uppercase mb-1">Not</p>
                    <p className="text-sm text-gray-700 italic">{selected.notes}</p>
                  </div>
                )}

                {/* Durum */}
                <div className="grid grid-cols-2 gap-6 mt-8 pt-4 border-t">
                  <div>
                    <p className="text-xs text-gray-500 uppercase mb-1">Durum</p>
                    {selected.status === 'processed' ? (
                      <span className="px-3 py-1 text-sm font-medium rounded-full bg-green-100 text-green-700">Islendi</span>
                    ) : (
                      <span className="px-3 py-1 text-sm font-medium rounded-full bg-amber-100 text-amber-700">Beklemede</span>
                    )}
                  </div>
                  {selected.processedAt && (
                    <div className="text-right">
                      <p className="text-xs text-gray-500 uppercase mb-1">Islenme Tarihi</p>
                      <p className="font-medium">
                        {format(new Date(selected.processedAt), 'dd MMM yyyy HH:mm', { locale: tr })}
                      </p>
                    </div>
                  )}
                </div>

                {/* Signature Area for Print */}
                <div className="grid grid-cols-2 gap-6 mt-8 pt-8 border-t print:block hidden">
                  <div>
                    <p className="text-sm text-gray-500 mb-12">Teslim Eden:</p>
                    <div className="border-t border-gray-400 pt-1">
                      <p className="text-xs text-gray-500">Imza / Tarih</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-12">Teslim Alan:</p>
                    <div className="border-t border-gray-400 pt-1">
                      <p className="text-xs text-gray-500">Imza / Tarih</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
