import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Edit, Trash2, RefreshCw, X, Check, QrCode, Download, Printer, Upload, FileSpreadsheet } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import QRCode from 'qrcode';
import * as XLSX from 'xlsx';
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
  etaDatabaseType: 'official' | 'unofficial' | null;
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
  etaDatabaseType: 'official' | 'unofficial';
}

const emptyForm: TenantForm = { name: '', email: '', phone: '', address: '', latitude: '', longitude: '', etaDatabaseType: 'official' };

export function HotelManagementPage() {
  const [showModal, setShowModal] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [form, setForm] = useState<TenantForm>(emptyForm);
  const [qrModalTenant, setQrModalTenant] = useState<Tenant | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ total: number; current: number; results: { name: string; success: boolean; error?: string }[] }>({ total: 0, current: 0, results: [] });
  const [showImportModal, setShowImportModal] = useState(false);
  const [showBulkDbModal, setShowBulkDbModal] = useState(false);
  const [bulkDbType, setBulkDbType] = useState<'official' | 'unofficial'>('official');
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const bulkUpdateDbMutation = useMutation({
    mutationFn: (newType: 'official' | 'unofficial') =>
      api.post('/tenants/bulk-update-database', { newType }),
    onSuccess: (res) => {
      toast.success(res.data.message || 'Toplu guncelleme basarili!');
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      setShowBulkDbModal(false);
    },
    onError: (err) => toast.error('Toplu guncelleme basarisiz', getErrorMessage(err)),
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
      etaDatabaseType: tenant.etaDatabaseType || 'official',
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

  // Excel Export
  const exportToExcel = () => {
    if (!tenants || tenants.length === 0) {
      toast.error('Disa aktarilacak otel bulunamadi');
      return;
    }

    const exportData = tenants.map(t => ({
      'Otel Adi': t.name,
      'E-posta': t.email,
      'Telefon': t.phone || '',
      'Adres': t.address || '',
      'Enlem': t.latitude || '',
      'Boylam': t.longitude || '',
      'QR Kod': t.qrCode || '',
      'Durum': t.isActive ? 'Aktif' : 'Pasif',
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Oteller');

    // Auto-size columns
    const colWidths = [
      { wch: 25 }, // Otel Adi
      { wch: 25 }, // E-posta
      { wch: 15 }, // Telefon
      { wch: 40 }, // Adres
      { wch: 12 }, // Enlem
      { wch: 12 }, // Boylam
      { wch: 15 }, // QR Kod
      { wch: 10 }, // Durum
    ];
    ws['!cols'] = colWidths;

    XLSX.writeFile(wb, `Oteller_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success('Excel dosyasi indirildi');
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
        const etaTypeValue = getColumnValue(row, 'ETA Tipi', 'ETA DB', 'Tip', 'Type').toLowerCase();
        const hotelData: TenantForm = {
          name: getColumnValue(row, 'Otel Adi', 'Otel Adı', 'name', 'Name', 'Otel', 'Hotel', 'Ad', 'Isim', 'İsim'),
          email: getColumnValue(row, 'E-posta', 'E-Posta', 'email', 'Email', 'Mail', 'Eposta'),
          phone: getColumnValue(row, 'Telefon', 'phone', 'Phone', 'Tel', 'Gsm', 'Cep'),
          address: getColumnValue(row, 'Adres', 'address', 'Address', 'Konum'),
          latitude: getColumnValue(row, 'Enlem', 'latitude', 'Lat'),
          longitude: getColumnValue(row, 'Boylam', 'longitude', 'Lng', 'Long'),
          etaDatabaseType: etaTypeValue.includes('gayri') || etaTypeValue.includes('unofficial') || etaTypeValue.includes('teklif') ? 'unofficial' : 'official',
        };

        if (!hotelData.name) {
          results.push({ name: `Satir ${i + 2}: Isim bos`, success: false, error: 'Otel adi bulunamadi' });
          setImportProgress(prev => ({ ...prev, current: i + 1, results: [...results] }));
          continue;
        }

        try {
          await api.post('/tenants', hotelData);
          results.push({ name: hotelData.name, success: true });
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Bilinmeyen hata';
          results.push({ name: hotelData.name, success: false, error: errorMsg });
        }

        setImportProgress(prev => ({ ...prev, current: i + 1, results: [...results] }));
      }

      const successCount = results.filter(r => r.success).length;
      const errorCount = results.filter(r => !r.success).length;

      if (successCount > 0) {
        toast.success(`${successCount} otel basariyla eklendi`);
        queryClient.invalidateQueries({ queryKey: ['tenants'] });
      }
      if (errorCount > 0) {
        toast.error(`${errorCount} otel eklenemedi`);
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
      {
        'Otel Adi': 'Ornek Otel',
        'E-posta': 'info@ornekotel.com',
        'Telefon': '+905001234567',
        'Adres': 'Istanbul, Turkiye',
        'Enlem': '41.0082',
        'Boylam': '28.9784',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Oteller');

    ws['!cols'] = [
      { wch: 25 },
      { wch: 25 },
      { wch: 15 },
      { wch: 40 },
      { wch: 12 },
      { wch: 12 },
    ];

    XLSX.writeFile(wb, 'Otel_Sablonu.xlsx');
    toast.success('Sablon indirildi');
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
        <div className="flex flex-wrap gap-2">
          {/* Hidden file input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".xlsx,.xls"
            className="hidden"
          />
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            Yenile
          </button>
          <button
            onClick={exportToExcel}
            className="flex items-center gap-2 px-3 py-2 text-green-600 hover:bg-green-50 rounded-lg border border-green-200 text-sm"
          >
            <Download className="w-4 h-4" />
            Excel Indir
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="flex items-center gap-2 px-3 py-2 text-orange-600 hover:bg-orange-50 rounded-lg border border-orange-200 text-sm disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            {isImporting ? 'Yukleniyor...' : 'Excel Yukle'}
          </button>
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200 text-sm"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Sablon
          </button>
          <button
            onClick={async () => {
              // Print all QR codes - one per page
              const hotelsWithQR = tenants?.filter(t => t.qrCode) || [];
              if (hotelsWithQR.length === 0) {
                toast.error('QR kodu olan otel bulunamadi');
                return;
              }

              toast.info(`${hotelsWithQR.length} otel icin QR kod olusturuluyor...`);

              // Generate QR code data URLs
              const qrDataUrls: { hotel: Tenant; dataUrl: string }[] = [];
              for (const hotel of hotelsWithQR) {
                try {
                  const dataUrl = await QRCode.toDataURL(hotel.qrCode!, {
                    width: 300,
                    margin: 2,
                    errorCorrectionLevel: 'H'
                  });
                  qrDataUrls.push({ hotel, dataUrl });
                } catch (err) {
                  console.error('QR error:', hotel.name, err);
                }
              }

              if (qrDataUrls.length === 0) {
                toast.error('QR kodlari olusturulamadi');
                return;
              }

              // Create HTML with one hotel per page
              const pages = qrDataUrls.map(({ hotel, dataUrl }) => `
                <div class="page">
                  <div class="card">
                    <h1>${hotel.name}</h1>
                    <p class="address">${hotel.address || ''}</p>
                    <img src="${dataUrl}" class="qr-img" />
                    <div class="qr-value">${hotel.qrCode}</div>
                    <p class="instructions">Bu QR kodu tarayarak oteli hizlica secebilirsiniz</p>
                  </div>
                </div>
              `).join('');

              const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Otel QR Kodlari</title>
  <style>
    @media print {
      @page { margin: 0; size: A4; }
      .page { page-break-after: always; }
      .page:last-child { page-break-after: auto; }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; }
    .page {
      width: 100%;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 40px;
    }
    .card {
      border: 4px solid #1f2937;
      border-radius: 24px;
      padding: 50px;
      text-align: center;
      max-width: 500px;
      width: 100%;
    }
    h1 { font-size: 32px; color: #1f2937; margin-bottom: 10px; }
    .address { color: #6b7280; font-size: 18px; margin-bottom: 30px; min-height: 24px; }
    .qr-img { width: 300px; height: 300px; display: block; margin: 0 auto 30px; }
    .qr-value {
      font-family: monospace;
      font-size: 24px;
      background: #f3f4f6;
      padding: 15px 30px;
      border-radius: 12px;
      display: inline-block;
      margin-bottom: 20px;
    }
    .instructions { color: #9ca3af; font-size: 14px; }
  </style>
</head>
<body>
  ${pages}
</body>
</html>`;

              // Create blob and open
              const blob = new Blob([html], { type: 'text/html' });
              const url = URL.createObjectURL(blob);
              const printWindow = window.open(url, '_blank');

              if (printWindow) {
                printWindow.onload = () => {
                  setTimeout(() => {
                    printWindow.print();
                    URL.revokeObjectURL(url);
                  }, 1000);
                };
              }
            }}
            className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg border border-blue-200"
          >
            <Printer className="w-4 h-4" />
            Tum QR Kodlari Yazdir
          </button>
          <button
            onClick={() => setShowBulkDbModal(true)}
            className="flex items-center gap-2 px-4 py-2 text-indigo-600 hover:bg-indigo-50 rounded-lg border border-indigo-200"
          >
            <RefreshCw className="w-4 h-4" />
            ETA DB Toplu
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
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ETA DB</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">QR Kod</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Durum</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Islemler</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{tenant.name}</td>
                  <td className="px-4 py-3 text-gray-600">{tenant.email || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{tenant.phone || '-'}</td>
                  <td className="px-4 py-3">
                    {tenant.etaDatabaseType === 'unofficial' ? (
                      <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-medium">
                        Gayri Resmi
                      </span>
                    ) : (
                      <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
                        Resmi
                      </span>
                    )}
                  </td>
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
                  E-posta
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                  placeholder="otel@ornek.com (opsiyonel)"
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
                  Google Maps'ten konum almak icin: Otelin konumuna sag tiklayin - Ilk satirdaki koordinatlari kopyalayin
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  ETA Veritabani Tipi
                </label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, etaDatabaseType: 'official' })}
                    className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
                      form.etaDatabaseType === 'official'
                        ? 'border-green-500 bg-green-50 text-green-700'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-medium">Resmi</div>
                    <div className="text-xs text-gray-500">DEMET</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, etaDatabaseType: 'unofficial' })}
                    className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
                      form.etaDatabaseType === 'unofficial'
                        ? 'border-red-500 bg-red-50 text-red-700'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-medium">Gayri Resmi</div>
                    <div className="text-xs text-gray-500">TEKLIF</div>
                  </button>
                </div>
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
                        // Create a canvas with hotel name and QR code
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        canvas.width = 400;
                        canvas.height = 500;

                        if (ctx) {
                          // White background
                          ctx.fillStyle = '#ffffff';
                          ctx.fillRect(0, 0, canvas.width, canvas.height);

                          // Border
                          ctx.strokeStyle = '#1f2937';
                          ctx.lineWidth = 3;
                          ctx.roundRect(10, 10, canvas.width - 20, canvas.height - 20, 16);
                          ctx.stroke();

                          // Hotel name
                          ctx.fillStyle = '#1f2937';
                          ctx.font = 'bold 24px Arial';
                          ctx.textAlign = 'center';
                          ctx.fillText(qrModalTenant.name, canvas.width / 2, 60);

                          // QR Code
                          const svg = document.getElementById(`qr-modal-${qrModalTenant.id}`);
                          if (svg) {
                            const svgData = new XMLSerializer().serializeToString(svg);
                            const img = new Image();
                            img.onload = () => {
                              ctx.drawImage(img, 100, 90, 200, 200);

                              // QR Value
                              ctx.fillStyle = '#f3f4f6';
                              ctx.fillRect(80, 320, 240, 50);
                              ctx.fillStyle = '#374151';
                              ctx.font = '20px monospace';
                              ctx.fillText(qrModalTenant.qrCode || '', canvas.width / 2, 352);

                              // Instructions
                              ctx.fillStyle = '#6b7280';
                              ctx.font = '14px Arial';
                              ctx.fillText('Bu QR kodu tarayarak', canvas.width / 2, 410);
                              ctx.fillText('oteli hizlica secebilirsiniz', canvas.width / 2, 430);

                              // Download
                              const pngFile = canvas.toDataURL('image/png');
                              const downloadLink = document.createElement('a');
                              downloadLink.download = `${qrModalTenant.name.replace(/\s+/g, '_')}_QR.png`;
                              downloadLink.href = pngFile;
                              downloadLink.click();
                            };
                            img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
                          }
                        }
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"
                    >
                      <Download className="w-4 h-4" />
                      Indir
                    </button>
                    <button
                      onClick={async () => {
                        // Generate QR code data URL
                        const dataUrl = await QRCode.toDataURL(qrModalTenant.qrCode!, {
                          width: 300,
                          margin: 2,
                          errorCorrectionLevel: 'H'
                        });

                        const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${qrModalTenant.name} - QR Kod</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { border: 4px solid #1f2937; border-radius: 24px; padding: 50px; text-align: center; max-width: 500px; }
    h1 { font-size: 32px; color: #1f2937; margin-bottom: 10px; }
    .address { color: #6b7280; font-size: 18px; margin-bottom: 30px; }
    .qr-img { width: 300px; height: 300px; display: block; margin: 0 auto 30px; }
    .qr-value { font-family: monospace; font-size: 24px; background: #f3f4f6; padding: 15px 30px; border-radius: 12px; display: inline-block; margin-bottom: 20px; }
    .instructions { color: #9ca3af; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${qrModalTenant.name}</h1>
    <p class="address">${qrModalTenant.address || ''}</p>
    <img src="${dataUrl}" class="qr-img" />
    <div class="qr-value">${qrModalTenant.qrCode}</div>
    <p class="instructions">Bu QR kodu tarayarak oteli hizlica secebilirsiniz</p>
  </div>
</body>
</html>`;

                        const blob = new Blob([html], { type: 'text/html' });
                        const url = URL.createObjectURL(blob);
                        const printWindow = window.open(url, '_blank');

                        if (printWindow) {
                          printWindow.onload = () => {
                            setTimeout(() => {
                              printWindow.print();
                              URL.revokeObjectURL(url);
                            }, 1000);
                          };
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

      {/* Import Progress Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="p-6 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold">Excel Yukleniyor</h2>
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
                    className="bg-purple-600 h-3 rounded-full transition-all duration-300"
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
                  className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                >
                  Kapat
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bulk Database Update Modal */}
      {showBulkDbModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="p-6 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold">Tum Otelleri Guncelle</h2>
              <button onClick={() => setShowBulkDbModal(false)} className="text-gray-500 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <p className="text-sm text-yellow-800">
                  Bu islem TUM otellerin ETA veritabani tipini degistirir!
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Yeni Veritabani Tipi
                </label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setBulkDbType('official')}
                    className={`flex-1 px-4 py-4 rounded-lg border-2 transition-all ${
                      bulkDbType === 'official'
                        ? 'border-green-500 bg-green-50 text-green-700'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="text-lg font-bold">Resmi</div>
                    <div className="text-sm text-gray-500">DEMET_{new Date().getFullYear()}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkDbType('unofficial')}
                    className={`flex-1 px-4 py-4 rounded-lg border-2 transition-all ${
                      bulkDbType === 'unofficial'
                        ? 'border-red-500 bg-red-50 text-red-700'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="text-lg font-bold">Gayri Resmi</div>
                    <div className="text-sm text-gray-500">TEKLIF_{new Date().getFullYear()}</div>
                  </button>
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowBulkDbModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  Iptal
                </button>
                <button
                  type="button"
                  onClick={() => bulkUpdateDbMutation.mutate(bulkDbType)}
                  disabled={bulkUpdateDbMutation.isPending}
                  className={`flex-1 px-4 py-2 text-white rounded-lg disabled:opacity-50 flex items-center justify-center gap-2 ${
                    bulkDbType === 'official' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {bulkUpdateDbMutation.isPending ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Tumu Guncelle
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
