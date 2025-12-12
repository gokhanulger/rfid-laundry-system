import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tags, Plus, Edit, Trash2, RefreshCw, X, Check } from 'lucide-react';
import api, { getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';

interface ItemType {
  id: string;
  name: string;
  description: string | null;
  tenantId: string | null;
  createdAt: string;
}

interface ItemTypeForm {
  name: string;
  description: string;
}

const emptyForm: ItemTypeForm = { name: '', description: '' };

export function ItemTypesPage() {
  const [showModal, setShowModal] = useState(false);
  const [editingItemType, setEditingItemType] = useState<ItemType | null>(null);
  const [form, setForm] = useState<ItemTypeForm>(emptyForm);
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: itemTypes, isLoading, refetch } = useQuery({
    queryKey: ['item-types'],
    queryFn: async () => {
      const res = await api.get('/item-types');
      return res.data as ItemType[];
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: ItemTypeForm) => api.post('/item-types', data),
    onSuccess: () => {
      toast.success('Urun turu basariyla olusturuldu!');
      queryClient.invalidateQueries({ queryKey: ['item-types'] });
      closeModal();
    },
    onError: (err) => toast.error('Urun turu olusturulamadi', getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ItemTypeForm> }) =>
      api.patch(`/item-types/${id}`, data),
    onSuccess: () => {
      toast.success('Urun turu basariyla guncellendi!');
      queryClient.invalidateQueries({ queryKey: ['item-types'] });
      closeModal();
    },
    onError: (err) => toast.error('Urun turu guncellenemedi', getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/item-types/${id}`),
    onSuccess: () => {
      toast.success('Urun turu silindi!');
      queryClient.invalidateQueries({ queryKey: ['item-types'] });
    },
    onError: (err) => toast.error('Urun turu silinemedi', getErrorMessage(err)),
  });

  const openCreateModal = () => {
    setEditingItemType(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEditModal = (itemType: ItemType) => {
    setEditingItemType(itemType);
    setForm({
      name: itemType.name,
      description: itemType.description || '',
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingItemType(null);
    setForm(emptyForm);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingItemType) {
      updateMutation.mutate({ id: editingItemType.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-teal-100 rounded-lg">
            <Tags className="w-8 h-8 text-teal-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Urun Turleri</h1>
            <p className="text-gray-500">Tekstil urun turlerini yonetin</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            Yenile
          </button>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
          >
            <Plus className="w-5 h-5" />
            Urun Turu Ekle
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="bg-white rounded-lg shadow p-4">
        <p className="text-3xl font-bold text-teal-600">{itemTypes?.length || 0}</p>
        <p className="text-sm text-gray-500">Toplam Urun Turu</p>
      </div>

      {/* Item Types Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">Urun Turleri Listesi</h2>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <RefreshCw className="w-8 h-8 animate-spin text-teal-500" />
          </div>
        ) : itemTypes && itemTypes.length > 0 ? (
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ad</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Aciklama</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Olusturulma</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Islemler</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {itemTypes.map((itemType) => (
                <tr key={itemType.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{itemType.name}</td>
                  <td className="px-4 py-3 text-gray-600">{itemType.description || '-'}</td>
                  <td className="px-4 py-3 text-gray-500 text-sm">
                    {new Date(itemType.createdAt).toLocaleDateString('tr-TR')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEditModal(itemType)}
                        className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Bu urun turunu silmek istediginizden emin misiniz?')) {
                            deleteMutation.mutate(itemType.id);
                          }
                        }}
                        className="p-1 text-red-600 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-12 text-center">
            <Tags className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <p className="text-xl text-gray-500">Urun turu bulunamadi</p>
            <p className="text-gray-400 mt-2">Baslamak icin ilk urun turunu ekleyin</p>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="p-6 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold">
                {editingItemType ? 'Urun Turu Duzenle' : 'Yeni Urun Turu Ekle'}
              </h2>
              <button onClick={closeModal} className="text-gray-500 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Urun Turu Adi *
                </label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                  placeholder="Ornegin: Nevresim, Havlu, Yorgan"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Aciklama
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                  placeholder="Urun turu hakkinda aciklama"
                  rows={3}
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  Iptal
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  {editingItemType ? 'Guncelle' : 'Olustur'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
