import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shirt, Loader2, Plus, Trash2, ChevronUp, ChevronDown, Eye, EyeOff, Check, X } from 'lucide-react';
import { dirtyFormProductsApi, getErrorMessage, DirtyFormProduct } from '../lib/api';
import { useToast } from '../components/Toast';

export function DirtyProductsAdminPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const { data: products, isLoading } = useQuery({
    queryKey: ['dirty-form-products', 'all'],
    queryFn: () => dirtyFormProductsApi.list(true),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['dirty-form-products'] });
  };

  const createMut = useMutation({
    mutationFn: (name: string) => dirtyFormProductsApi.create({ name }),
    onSuccess: () => { setNewName(''); invalidate(); },
    onError: (e) => toast.error('Eklenemedi', getErrorMessage(e)),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { name?: string; sortOrder?: number; isActive?: boolean } }) =>
      dirtyFormProductsApi.update(id, payload),
    onSuccess: () => { setEditId(null); invalidate(); },
    onError: (e) => toast.error('Guncellenemedi', getErrorMessage(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => dirtyFormProductsApi.remove(id),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error('Silinemedi', getErrorMessage(e)),
  });

  const list: DirtyFormProduct[] = products || [];

  // Iki urunun sirasini takas et (yukari/asagi)
  const swap = (idx: number, dir: -1 | 1) => {
    const a = list[idx];
    const b = list[idx + dir];
    if (!a || !b) return;
    updateMut.mutate({ id: a.id, payload: { sortOrder: b.sortOrder } });
    updateMut.mutate({ id: b.id, payload: { sortOrder: a.sortOrder } });
  };

  const startEdit = (p: DirtyFormProduct) => { setEditId(p.id); setEditName(p.name); };
  const saveEdit = () => {
    if (editId && editName.trim()) updateMut.mutate({ id: editId, payload: { name: editName.trim() } });
  };

  return (
    <div className="p-4 md:p-6 bg-gray-50 min-h-screen">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Shirt className="w-7 h-7 text-orange-600" />
          Kirli Irsaliye Urun Listesi
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Burada belirlediginiz urunler, otellerin "Kirli Teslim Fisi" ekraninda gorunur. Otel ayrica manuel urun de ekleyebilir.
        </p>
      </div>

      {/* Yeni urun ekle */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6 flex items-center gap-2">
        <input
          type="text"
          placeholder="Yeni urun adi (orn. CARSAF)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) createMut.mutate(newName.trim()); }}
          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
        />
        <button
          onClick={() => newName.trim() && createMut.mutate(newName.trim())}
          disabled={!newName.trim() || createMut.isPending}
          className="flex items-center gap-1 px-4 py-2 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 disabled:opacity-40"
        >
          {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Ekle
        </button>
      </div>

      {/* Liste */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        {isLoading ? (
          <div className="p-8 text-center"><Loader2 className="w-8 h-8 animate-spin text-orange-600 mx-auto" /></div>
        ) : list.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {list.map((p, idx) => (
              <div key={p.id} className={`flex items-center gap-3 px-4 py-2.5 ${!p.isActive ? 'opacity-50' : ''}`}>
                {/* Sira */}
                <div className="flex flex-col">
                  <button onClick={() => swap(idx, -1)} disabled={idx === 0} className="text-gray-300 hover:text-gray-600 disabled:opacity-30">
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button onClick={() => swap(idx, 1)} disabled={idx === list.length - 1} className="text-gray-300 hover:text-gray-600 disabled:opacity-30">
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>

                {/* Ad / duzenleme */}
                {editId === p.id ? (
                  <div className="flex-1 flex items-center gap-2">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditId(null); }}
                      autoFocus
                      className="flex-1 px-2 py-1 border border-orange-300 rounded-md focus:ring-2 focus:ring-orange-500"
                    />
                    <button onClick={saveEdit} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check className="w-4 h-4" /></button>
                    <button onClick={() => setEditId(null)} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <button onClick={() => startEdit(p)} className="flex-1 text-left text-sm font-medium text-gray-800 hover:text-orange-600">
                    {p.name}
                  </button>
                )}

                {/* Aktif/pasif */}
                <button
                  onClick={() => updateMut.mutate({ id: p.id, payload: { isActive: !p.isActive } })}
                  className={`p-1.5 rounded-lg ${p.isActive ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}
                  title={p.isActive ? 'Aktif (otel goruyor) - gizle' : 'Pasif - goster'}
                >
                  {p.isActive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>

                {/* Sil */}
                <button
                  onClick={() => { if (confirm(`"${p.name}" silinsin mi?`)) deleteMut.mutate(p.id); }}
                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                  title="Sil"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            <Shirt className="w-12 h-12 text-gray-300 mx-auto mb-2" />
            Henuz urun yok. Yukaridan ekleyin.
          </div>
        )}
      </div>
    </div>
  );
}
