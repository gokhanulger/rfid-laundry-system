import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Shirt, Loader2, CheckCircle2, Clock, Building2, RefreshCw, FileText } from 'lucide-react';
import { dirtyDeclarationsApi, getErrorMessage, DirtyDeclaration } from '../lib/api';
import { useToast } from '../components/Toast';
import { DirtyWaybillModal } from '../components/DirtyWaybillModal';

export function DirtyDeclarationsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [showProcessed, setShowProcessed] = useState(false);
  const [selected, setSelected] = useState<DirtyDeclaration | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['dirty-declarations', showProcessed ? 'all' : 'pending'],
    queryFn: () => dirtyDeclarationsApi.list({
      status: showProcessed ? undefined : 'pending',
      limit: 200,
      days: 60, // 60 gun geriye donuk takip
    }),
    refetchInterval: 30 * 1000, // canli liste: 30 sn'de bir yenile
  });

  const processMutation = useMutation({
    mutationFn: (id: string) => dirtyDeclarationsApi.process(id),
    onSuccess: () => {
      toast.success('Beyan islendi olarak isaretlendi');
      queryClient.invalidateQueries({ queryKey: ['dirty-declarations'] });
    },
    onError: (err) => toast.error('Islem basarisiz', getErrorMessage(err)),
  });

  const declarations: DirtyDeclaration[] = data?.data || [];
  const pendingCount = declarations.filter((d) => d.status === 'pending').length;

  return (
    <div className="p-4 md:p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Shirt className="w-7 h-7 text-orange-600" />
            Gelen Kirli Beyanlar
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Otellerin portaldan bildirdigi kirli urunler. Utucu o oteli isleyip etiket basinca otomatik "Islendi" olur.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showProcessed}
              onChange={(e) => setShowProcessed(e.target.checked)}
              className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
            />
            Islenenleri de goster
          </label>
          <button
            onClick={() => refetch()}
            className="p-2 text-gray-500 hover:text-gray-800 bg-white rounded-lg border border-gray-200"
            title="Yenile"
          >
            <RefreshCw className={`w-5 h-5 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Bekleyen ozeti */}
      {!showProcessed && (
        <div className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
          <Clock className="w-4 h-4" /> {pendingCount} bekleyen beyan
        </div>
      )}

      {/* Liste */}
      {isLoading ? (
        <div className="p-12 text-center bg-white rounded-xl border border-gray-100">
          <Loader2 className="w-8 h-8 animate-spin text-orange-600 mx-auto" />
          <p className="mt-2 text-gray-500">Yukleniyor...</p>
        </div>
      ) : declarations.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {declarations.map((d) => {
            const total = d.items.reduce((s, it) => s + it.count, 0);
            return (
              <div
                key={d.id}
                className={`bg-white rounded-xl shadow-sm border p-4 ${d.status === 'pending' ? 'border-amber-200' : 'border-gray-100'}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 font-semibold text-gray-900">
                    <Building2 className="w-5 h-5 text-gray-400" />
                    {d.tenantName || 'Bilinmeyen Otel'}
                    <span className="text-sm font-bold text-orange-600">No: {d.declarationNo ?? '-'}</span>
                  </div>
                  {d.status === 'processed' ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Yikandi
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-full">
                      <Clock className="w-3.5 h-3.5" /> Beklemede
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 mb-3">
                  {d.items.map((it, idx) => (
                    <span key={idx} className="text-sm bg-gray-100 text-gray-700 px-2.5 py-1 rounded-lg">
                      {it.itemTypeName}: <span className="font-semibold">{it.count}</span>
                    </span>
                  ))}
                  <span className="text-sm bg-orange-100 text-orange-800 px-2.5 py-1 rounded-lg font-semibold">
                    Toplam: {total}
                  </span>
                </div>

                {d.notes && (
                  <p className="text-sm text-gray-500 italic mb-3 bg-gray-50 rounded-lg px-3 py-2">{d.notes}</p>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    {format(new Date(d.createdAt), 'dd MMM yyyy HH:mm', { locale: tr })}
                    {d.status === 'processed' && d.processedAt && (
                      <> · Islendi: {format(new Date(d.processedAt), 'dd MMM HH:mm', { locale: tr })}</>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelected(d)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700"
                    >
                      <FileText className="w-4 h-4" /> Irsaliye
                    </button>
                    {d.status === 'pending' && (
                      <button
                        onClick={() => processMutation.mutate(d.id)}
                        disabled={processMutation.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg font-medium hover:bg-green-700 disabled:opacity-40"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Yikandi
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-12 text-center bg-white rounded-xl border border-gray-100">
          <Shirt className="w-12 h-12 text-gray-300 mx-auto" />
          <p className="mt-2 text-gray-500">
            {showProcessed ? 'Beyan bulunamadi' : 'Bekleyen kirli beyani yok'}
          </p>
        </div>
      )}

      {selected && (
        <DirtyWaybillModal
          declaration={selected}
          hotelName={selected.tenantName || 'Otel'}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
