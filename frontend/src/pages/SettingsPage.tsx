import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Tags, Plus, Edit, Trash2, RefreshCw, X, Check, Upload, Download, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
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

export function SettingsPage() {
  const [showModal, setShowModal] = useState(false);
  const [editingItemType, setEditingItemType] = useState<ItemType | null>(null);
  const [form, setForm] = useState<ItemTypeForm>(emptyForm);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ total: number; current: number; results: { name: string; success: boolean; error?: string }[] }>({ total: 0, current: 0, results: [] });
  const [showImportModal, setShowImportModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  // Excel Import
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setShowImportModal(true);
    setImportProgress({ total: 0, current: 0, results: [] });

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(sheet) as Record<string, string>[];

      if (jsonData.length === 0) {
        toast.error('Excel dosyasi bos');
        setShowImportModal(false);
        return;
      }

      setImportProgress({ total: jsonData.length, current: 0, results: [] });

      const results: { name: string; success: boolean; error?: string }[] = [];

      // Helper function to find column value (case insensitive)
      const getColumnValue = (row: Record<string, string>, ...possibleNames: string[]): string => {
        const keys = Object.keys(row);
        for (const name of possibleNames) {
          const found = keys.find(k => k.toLowerCase().trim() === name.toLowerCase().trim());
          if (found && row[found]) {
            return String(row[found]).trim();
          }
        }
        return '';
      };

      for (let i = 0; i < jsonData.length; i++) {
        const row = jsonData[i];
        const itemTypeData: ItemTypeForm = {
          name: getColumnValue(row, 'Urun Turu', 'Ürün Türü', 'name', 'Name', 'Ad', 'Tur', 'Tür', 'Isim', 'İsim'),
          description: getColumnValue(row, 'Aciklama', 'Açıklama', 'description', 'Description', 'Tanim', 'Tanım'),
        };

        if (!itemTypeData.name) {
          results.push({ name: `Satir ${i + 2}: Isim bos`, success: false, error: 'Urun turu adi bulunamadi' });
          setImportProgress(prev => ({ ...prev, current: i + 1, results: [...results] }));
          continue;
        }

        try {
          await api.post('/item-types', itemTypeData);
          results.push({ name: itemTypeData.name, success: true });
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Bilinmeyen hata';
          results.push({ name: itemTypeData.name, success: false, error: errorMsg });
        }

        setImportProgress(prev => ({ ...prev, current: i + 1, results: [...results] }));
      }

      const successCount = results.filter(r => r.success).length;
      const errorCount = results.filter(r => !r.success).length;

      if (successCount > 0) {
        toast.success(`${successCount} urun turu basariyla eklendi`);
        queryClient.invalidateQueries({ queryKey: ['item-types'] });
      }
      if (errorCount > 0) {
        toast.error(`${errorCount} urun turu eklenemedi`);
      }
    } catch (err) {
      toast.error('Excel dosyasi okunamadi');
      setShowImportModal(false);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Download template
  const downloadTemplate = () => {
    const templateData = [
      { 'Urun Turu': 'Nevresim', 'Aciklama': 'Yatak nevresimleri' },
      { 'Urun Turu': 'Havlu', 'Aciklama': 'Banyo havlulari' },
      { 'Urun Turu': 'Pike', 'Aciklama': 'Yatak pikeleri' },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Urun Turleri');
    XLSX.writeFile(wb, 'Urun_Turleri_Sablon.xlsx');
    toast.success('Sablon indirildi');
  };

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-3 bg-gray-100 rounded-lg">
          <Settings className="w-8 h-8 text-gray-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ayarlar</h1>
          <p className="text-gray-500">Sistem ayarlarini yonetin</p>
        </div>
      </div>

      {/* Item Types Section */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="p-4 border-b bg-teal-50 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Tags className="w-6 h-6 text-teal-600" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Urun Turleri</h2>
              <p className="text-sm text-gray-500">Tekstil urun turlerini tanimlayin</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={downloadTemplate}
              className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:bg-white rounded-lg text-sm"
              title="Excel sablonu indir"
            >
              <Download className="w-4 h-4" />
              Sablon
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".xlsx,.xls"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="flex items-center gap-2 px-3 py-2 bg-green-100 text-green-700 hover:bg-green-200 rounded-lg text-sm"
            >
              <Upload className="w-4 h-4" />
              {isImporting ? 'Yukleniyor...' : 'Excel Yukle'}
            </button>
            <button
              onClick={() => refetch()}
              className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:bg-white rounded-lg text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              Yenile
            </button>
            <button
              onClick={openCreateModal}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
            >
              <Plus className="w-5 h-5" />
              Ekle
            </button>
          </div>
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
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Islemler</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {itemTypes.map((itemType) => (
                <tr key={itemType.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{itemType.name}</td>
                  <td className="px-4 py-3 text-gray-600">{itemType.description || '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEditModal(itemType)}
                        className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                        title="Duzenle"
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
                        title="Sil"
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
            <p className="text-gray-400 mt-2">Baslamak icin ilk urun turunu ekleyin veya Excel yukleyin</p>
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

      {/* Import Progress Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="p-6 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <FileSpreadsheet className="w-6 h-6 text-teal-600" />
                Excel Yukleniyor
              </h2>
              {!isImporting && (
                <button onClick={() => setShowImportModal(false)} className="text-gray-500 hover:text-gray-700">
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
            <div className="p-6 flex-1 overflow-auto">
              {/* Progress Bar */}
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-1">
                  <span>{importProgress.current} / {importProgress.total}</span>
                  <span>{importProgress.total > 0 ? Math.round((importProgress.current / importProgress.total) * 100) : 0}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-teal-600 h-3 rounded-full transition-all duration-300"
                    style={{ width: `${importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>

              {/* Results List */}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {importProgress.results.map((result, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                      result.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
                    }`}
                  >
                    {result.success ? (
                      <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
                    ) : (
                      <X className="w-4 h-4 text-red-600 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{result.name}</span>
                      {result.error && (
                        <p className="text-xs text-red-600 truncate">{result.error}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Summary */}
              {!isImporting && importProgress.results.length > 0 && (
                <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm">
                    <span className="text-green-600 font-bold">{importProgress.results.filter(r => r.success).length}</span> basarili,{' '}
                    <span className="text-red-600 font-bold">{importProgress.results.filter(r => !r.success).length}</span> basarisiz
                  </p>
                </div>
              )}
            </div>
            {!isImporting && (
              <div className="p-4 border-t">
                <button
                  onClick={() => setShowImportModal(false)}
                  className="w-full px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
                >
                  Kapat
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
