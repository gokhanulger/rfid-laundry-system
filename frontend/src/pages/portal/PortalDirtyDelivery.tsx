import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import { Shirt, Loader2, ChevronLeft, Plus, Trash2, Send, CheckCircle2, Clock } from 'lucide-react';
import { portalApi, settingsApi, getErrorMessage, DirtyDeclaration } from '../../lib/api';
import { useToast } from '../../components/Toast';
import type { ItemType } from '../../types';

interface DraftLine { itemTypeId: string; count: string }

export function PortalDirtyDelivery() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [lines, setLines] = useState<DraftLine[]>([{ itemTypeId: '', count: '' }]);
  const [notes, setNotes] = useState('');

  const { data: itemTypes } = useQuery({
    queryKey: ['item-types'],
    queryFn: () => settingsApi.getItemTypes(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['portal', 'dirty-declarations'],
    queryFn: () => portalApi.getDirtyDeclarations({ limit: 50 }),
  });

  const typesList: ItemType[] = useMemo(() => itemTypes || [], [itemTypes]);

  const createMutation = useMutation({
    mutationFn: () => {
      const items = lines
        .filter((l) => l.itemTypeId && parseInt(l.count) > 0)
        .map((l) => ({ itemTypeId: l.itemTypeId, count: parseInt(l.count) }));
      return portalApi.createDirtyDeclaration({ items, notes: notes.trim() || undefined });
    },
    onSuccess: () => {
      toast.success('Kirli teslim bildirildi', 'Camasirhane ekranina dustu.');
      setLines([{ itemTypeId: '', count: '' }]);
      setNotes('');
      queryClient.invalidateQueries({ queryKey: ['portal', 'dirty-declarations'] });
    },
    onError: (err) => toast.error('Bildirim basarisiz', getErrorMessage(err)),
  });

  const validLines = lines.filter((l) => l.itemTypeId && parseInt(l.count) > 0);
  const totalCount = validLines.reduce((sum, l) => sum + parseInt(l.count || '0'), 0);

  const updateLine = (idx: number, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLines((prev) => [...prev, { itemTypeId: '', count: '' }]);
  const removeLine = (idx: number) => setLines((prev) => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);

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

      {/* Yeni beyan formu */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Yeni Kirli Bildirimi</h2>

        <div className="space-y-3">
          {lines.map((line, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select
                value={line.itemTypeId}
                onChange={(e) => updateLine(idx, { itemTypeId: e.target.value })}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white"
              >
                <option value="">Urun tipi secin...</option>
                {typesList.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                placeholder="Adet"
                value={line.count}
                onChange={(e) => updateLine(idx, { count: e.target.value.replace(/[^0-9]/g, '') })}
                className="w-24 px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-center"
              />
              <button
                onClick={() => removeLine(idx)}
                disabled={lines.length === 1}
                className="p-2 text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-gray-400"
                title="Satiri sil"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={addLine}
          className="mt-3 flex items-center gap-1 text-sm text-orange-600 hover:text-orange-800 font-medium"
        >
          <Plus className="w-4 h-4" /> Urun ekle
        </button>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Not (istege bagli)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Ornek: aceleli, lekeli urunler ayri torbada..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-none"
          />
        </div>

        <div className="mt-5 flex items-center justify-between">
          <span className="text-sm text-gray-500">
            {validLines.length > 0 ? `${validLines.length} tip / toplam ${totalCount} adet` : 'En az bir urun ekleyin'}
          </span>
          <button
            onClick={() => createMutation.mutate()}
            disabled={validLines.length === 0 || createMutation.isPending}
            className="flex items-center gap-2 px-5 py-2.5 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {createMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            Teslim Et
          </button>
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
              <div key={d.id} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500">
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
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center">
            <Shirt className="w-12 h-12 text-gray-300 mx-auto" />
            <p className="mt-2 text-gray-500">Henuz kirli bildirimi yok</p>
          </div>
        )}
      </div>
    </div>
  );
}
