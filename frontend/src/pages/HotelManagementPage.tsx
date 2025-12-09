import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Edit, Trash2, RefreshCw, X, Check, QrCode, Download, Printer } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import api, { getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';

interface Tenant {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  qrCode: string | null;
  isActive: boolean;
  createdAt: string;
}

interface TenantForm {
  name: string;
  email: string;
  phone: string;
  address: string;
  latitude: string;
  longitude: string;
}

const emptyForm: TenantForm = { name: '', email: '', phone: '', address: '', latitude: '', longitude: '' };

export function HotelManagementPage() {
  const [showModal, setShowModal] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [form, setForm] = useState<TenantForm>(emptyForm);
  const [qrModalTenant, setQrModalTenant] = useState<Tenant | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: tenants, isLoading, refetch } = useQuery({
    queryKey: ['tenants'],
    queryFn: async () => {
      const res = await api.get('/tenants');
      return res.data as Tenant[];
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: TenantForm) => api.post('/tenants', data),
    onSuccess: () => {
      toast.success('Otel basariyla olusturuldu!');
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      closeModal();
    },
    onError: (err) => toast.error('Otel olusturulamadi', getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<TenantForm> }) =>
      api.patch(`/tenants/${id}`, data),
    onSuccess: () => {
      toast.success('Otel basariyla guncellendi!');
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      closeModal();
    },
    onError: (err) => toast.error('Otel guncellenemedi', getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/tenants/${id}`),
    onSuccess: () => {
      toast.success('Otel silindi!');
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (err) => toast.error('Otel silinemedi', getErrorMessage(err)),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/tenants/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (err) => toast.error('Durum guncellenemedi', getErrorMessage(err)),
  });

  const openCreateModal = () => {
    setEditingTenant(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEditModal = (tenant: Tenant) => {
    setEditingTenant(tenant);
    setForm({
      name: tenant.name,
      email: tenant.email,
      phone: tenant.phone || '',
      address: tenant.address || '',
      latitude: tenant.latitude || '',
      longitude: tenant.longitude || '',
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingTenant(null);
    setForm(emptyForm);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingTenant) {
      updateMutation.mutate({ id: editingTenant.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-purple-100 rounded-lg">
            <Building2 className="w-8 h-8 text-purple-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Otel Yonetimi</h1>
            <p className="text-gray-500">Otelleri ve bilgilerini yonetin</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <RefreshCw className="w-4 h-4" />
            Yenile
          </button>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
          >
            <Plus className="w-5 h-5" />
            Otel Ekle
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-3xl font-bold text-purple-600">{tenants?.length || 0}</p>
          <p className="text-sm text-gray-500">Toplam Otel</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-3xl font-bold text-green-600">
            {tenants?.filter(t => t.isActive).length || 0}
          </p>
          <p className="text-sm text-gray-500">Aktif</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-3xl font-bold text-gray-600">
            {tenants?.filter(t => !t.isActive).length || 0}
          </p>
          <p className="text-sm text-gray-500">Pasif</p>
        </div>
      </div>

      {/* Hotels Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">Oteller</h2>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <RefreshCw className="w-8 h-8 animate-spin text-purple-500" />
          </div>
        ) : tenants && tenants.length > 0 ? (
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ad</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">E-posta</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Telefon</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">QR Kod</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Durum</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Islemler</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{tenant.name}</td>
                  <td className="px-4 py-3 text-gray-600">{tenant.email}</td>
                  <td className="px-4 py-3 text-gray-600">{tenant.phone || '-'}</td>
                  <td className="px-4 py-3">
                    {tenant.qrCode ? (
                      <button
                        onClick={() => setQrModalTenant(tenant)}
                        className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-mono hover:bg-blue-200"
                      >
                        <QrCode className="w-3 h-3" />
                        {tenant.qrCode}
                      </button>
                    ) : (
                      <span className="text-gray-400 text-xs">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActiveMutation.mutate({ id: tenant.id, isActive: !tenant.isActive })}
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        tenant.isActive
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {tenant.isActive ? 'Aktif' : 'Pasif'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEditModal(tenant)}
                        className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Bu oteli silmek istediginizden emin misiniz?')) {
                            deleteMutation.mutate(tenant.id);
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
            <Building2 className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <p className="text-xl text-gray-500">Otel bulunamadi</p>
            <p className="text-gray-400 mt-2">Baslamak icin ilk otelinizi ekleyin</p>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="p-6 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold">
                {editingTenant ? 'Otel Duzenle' : 'Yeni Otel Ekle'}
              </h2>
              <button onClick={closeModal} className="text-gray-500 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Otel Adi *
                </label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                  placeholder="Otel adini girin"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  E-posta *
                </label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                  placeholder="otel@ornek.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Telefon
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                  placeholder="+90 xxx xxx xxxx"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Adres
                </label>
                <textarea
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                  placeholder="Tam adres"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Enlem (Latitude)
                  </label>
                  <input
                    type="text"
                    value={form.latitude}
                    onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                    placeholder="41.0082"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Boylam (Longitude)
                  </label>
                  <input
                    type="text"
                    value={form.longitude}
                    onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                    placeholder="28.9784"
                  />
                </div>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs text-blue-800">
                  💡 Google Maps'ten konum almak için: Otelin konumuna sağ tıklayın → İlk satırdaki koordinatları kopyalayın
                </p>
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
                  className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  {editingTenant ? 'Guncelle' : 'Olustur'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QR Code Modal */}
      {qrModalTenant && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
            <div className="p-6 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold">{qrModalTenant.name}</h2>
              <button onClick={() => setQrModalTenant(null)} className="text-gray-500 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 flex flex-col items-center">
              {qrModalTenant.qrCode && (
                <>
                  <QRCodeSVG
                    id={`qr-modal-${qrModalTenant.id}`}
                    value={qrModalTenant.qrCode}
                    size={200}
                    level="H"
                    includeMargin={true}
                  />
                  <div className="mt-4 bg-gray-100 rounded-lg px-4 py-2">
                    <code className="text-lg font-mono text-gray-700">
                      {qrModalTenant.qrCode}
                    </code>
                  </div>
                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={() => {
                        const svg = document.getElementById(`qr-modal-${qrModalTenant.id}`);
                        if (svg) {
                          const svgData = new XMLSerializer().serializeToString(svg);
                          const canvas = document.createElement('canvas');
                          const ctx = canvas.getContext('2d');
                          const img = new Image();
                          img.onload = () => {
                            canvas.width = 300;
                            canvas.height = 300;
                            ctx?.drawImage(img, 0, 0, 300, 300);
                            const pngFile = canvas.toDataURL('image/png');
                            const downloadLink = document.createElement('a');
                            downloadLink.download = `${qrModalTenant.name.replace(/\s+/g, '_')}_QR.png`;
                            downloadLink.href = pngFile;
                            downloadLink.click();
                          };
                          img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
                        }
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"
                    >
                      <Download className="w-4 h-4" />
                      Indir
                    </button>
                    <button
                      onClick={() => {
                        const printWindow = window.open('', '_blank');
                        if (printWindow) {
                          printWindow.document.write(`
                            <html>
                              <head>
                                <title>${qrModalTenant.name} - QR Kod</title>
                                <style>
                                  body { font-family: Arial; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
                                  .card { border: 3px solid #1f2937; border-radius: 16px; padding: 40px; text-align: center; }
                                  h2 { margin: 0 0 10px; }
                                  .qr-value { font-family: monospace; font-size: 18px; background: #f3f4f6; padding: 8px 16px; border-radius: 8px; }
                                </style>
                              </head>
                              <body>
                                <div class="card">
                                  <h2>${qrModalTenant.name}</h2>
                                  <p>${qrModalTenant.address || ''}</p>
                                  <div id="qr"></div>
                                  <div class="qr-value">${qrModalTenant.qrCode}</div>
                                </div>
                                <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
                                <script>
                                  QRCode.toCanvas(document.createElement('canvas'), '${qrModalTenant.qrCode}', { width: 200 }, function(err, canvas) {
                                    if (!err) document.getElementById('qr').appendChild(canvas);
                                  });
                                </script>
                              </body>
                            </html>
                          `);
                          printWindow.document.close();
                          setTimeout(() => printWindow.print(), 500);
                        }
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                    >
                      <Printer className="w-4 h-4" />
                      Yazdir
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
