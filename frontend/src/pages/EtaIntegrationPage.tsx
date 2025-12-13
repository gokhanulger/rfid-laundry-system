import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Database,
  RefreshCw,
  Check,
  X,
  AlertCircle,
  Building2,
  Package,
  FileText,
  ArrowRightLeft,
  Settings2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import api, { getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';

interface EtaStatusResponse {
  success: boolean;
  message: string;
  version?: string;
}

interface EtaCari {
  kod: string;
  unvan: string;
  adres?: string;
  telefon?: string;
  email?: string;
  aktif: boolean;
}

interface EtaStok {
  kod: string;
  ad: string;
  aciklama?: string;
  birim?: string;
  aktif: boolean;
}

interface SyncResult {
  success: boolean;
  message: string;
  imported?: number;
  updated?: number;
  errors?: string[];
}

export function EtaIntegrationPage() {
  const toast = useToast();
  const [showTables, setShowTables] = useState(false);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [showCariler, setShowCariler] = useState(false);
  const [showStoklar, setShowStoklar] = useState(false);

  // ETA bağlantı durumu
  const { data: etaStatus, isLoading: isStatusLoading, refetch: refetchStatus } = useQuery<EtaStatusResponse>({
    queryKey: ['eta-status'],
    queryFn: async () => {
      const res = await api.get('/eta/status');
      return res.data;
    },
    retry: false,
  });

  // ETA tabloları
  const { data: etaTables, isLoading: isTablesLoading } = useQuery<{ tables: string[] }>({
    queryKey: ['eta-tables'],
    queryFn: async () => {
      const res = await api.get('/eta/tables');
      return res.data;
    },
    enabled: showTables && etaStatus?.success === true,
  });

  // Tablo yapısı
  const { data: tableColumns } = useQuery<{ columns: { name: string; type: string; nullable: boolean }[] }>({
    queryKey: ['eta-table-columns', selectedTable],
    queryFn: async () => {
      const res = await api.get(`/eta/table/${selectedTable}`);
      return res.data;
    },
    enabled: !!selectedTable,
  });

  // ETA cari kartları
  const { data: etaCariler, isLoading: isCarilerLoading } = useQuery<{ data: EtaCari[] }>({
    queryKey: ['eta-cariler'],
    queryFn: async () => {
      const res = await api.get('/eta/cariler');
      return res.data;
    },
    enabled: showCariler && etaStatus?.success === true,
  });

  // ETA stok kartları
  const { data: etaStoklar, isLoading: isStokLoading } = useQuery<{ data: EtaStok[] }>({
    queryKey: ['eta-stoklar'],
    queryFn: async () => {
      const res = await api.get('/eta/stoklar');
      return res.data;
    },
    enabled: showStoklar && etaStatus?.success === true,
  });

  // Cari senkronizasyonu
  const syncCariMutation = useMutation<SyncResult>({
    mutationFn: async () => {
      const res = await api.post('/eta/sync/cariler');
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.error(data.message);
      }
    },
    onError: (err) => toast.error('Senkronizasyon hatasi', getErrorMessage(err)),
  });

  // Stok senkronizasyonu
  const syncStokMutation = useMutation<SyncResult>({
    mutationFn: async () => {
      const res = await api.post('/eta/sync/stoklar');
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.error(data.message);
      }
    },
    onError: (err) => toast.error('Senkronizasyon hatasi', getErrorMessage(err)),
  });

  // Tum senkronizasyon
  const syncAllMutation = useMutation<{ success: boolean; cariler: SyncResult; stoklar: SyncResult }>({
    mutationFn: async () => {
      const res = await api.post('/eta/sync/all');
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success('Tum veriler senkronize edildi');
      } else {
        toast.error('Bazi veriler senkronize edilemedi');
      }
    },
    onError: (err) => toast.error('Senkronizasyon hatasi', getErrorMessage(err)),
  });

  const isConnected = etaStatus?.success === true;

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-3 bg-indigo-100 rounded-lg">
          <Database className="w-8 h-8 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ETA V.8 SQL Entegrasyonu</h1>
          <p className="text-gray-500">ETA muhasebe yazilimi ile senkronizasyon</p>
        </div>
      </div>

      {/* Baglanti Durumu */}
      <div className={`rounded-lg p-6 ${isConnected ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isStatusLoading ? (
              <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
            ) : isConnected ? (
              <Check className="w-6 h-6 text-green-600" />
            ) : (
              <X className="w-6 h-6 text-red-600" />
            )}
            <div>
              <h3 className="font-semibold text-gray-900">
                {isStatusLoading ? 'Baglanti kontrol ediliyor...' : isConnected ? 'ETA Baglantisi Aktif' : 'ETA Baglantisi Yok'}
              </h3>
              <p className="text-sm text-gray-600">
                {etaStatus?.message || 'Baglanti durumu bekleniyor'}
              </p>
            </div>
          </div>
          <button
            onClick={() => refetchStatus()}
            disabled={isStatusLoading}
            className="flex items-center gap-2 px-4 py-2 bg-white border rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isStatusLoading ? 'animate-spin' : ''}`} />
            Yenile
          </button>
        </div>
      </div>

      {/* Baglanti yoksa uyari */}
      {!isConnected && !isStatusLoading && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="font-medium text-yellow-800">Baglanti Ayarlari</h4>
            <p className="text-sm text-yellow-700 mt-1">
              ETA SQL Server'a baglanmak icin backend/.env dosyasinda asagidaki degiskenleri ayarlayin:
            </p>
            <pre className="mt-2 bg-yellow-100 p-3 rounded text-xs font-mono overflow-x-auto">
{`ETA_SQL_SERVER=192.168.1.100
ETA_SQL_PORT=1433
ETA_SQL_DATABASE=ETA
ETA_SQL_USER=sa
ETA_SQL_PASSWORD=sifreniz`}
            </pre>
          </div>
        </div>
      )}

      {/* Ana Islemler */}
      {isConnected && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Cariler (Oteller) */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="p-4 border-b bg-blue-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Building2 className="w-6 h-6 text-blue-600" />
                <div>
                  <h2 className="font-semibold text-gray-900">Cari Kartlar (Oteller)</h2>
                  <p className="text-sm text-gray-500">ETA'daki carileri otellere aktar</p>
                </div>
              </div>
              <button
                onClick={() => setShowCariler(!showCariler)}
                className="text-gray-500 hover:text-gray-700"
              >
                {showCariler ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </button>
            </div>

            {showCariler && (
              <div className="p-4">
                {isCarilerLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                  </div>
                ) : etaCariler?.data && etaCariler.data.length > 0 ? (
                  <>
                    <div className="mb-4 text-sm text-gray-600">
                      ETA'da {etaCariler.data.length} cari bulundu
                    </div>
                    <div className="max-h-64 overflow-y-auto border rounded-lg">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left">Kod</th>
                            <th className="px-3 py-2 text-left">Unvan</th>
                            <th className="px-3 py-2 text-left">Durum</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {etaCariler.data.slice(0, 50).map((cari, idx) => (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="px-3 py-2 font-mono text-xs">{cari.kod}</td>
                              <td className="px-3 py-2">{cari.unvan}</td>
                              <td className="px-3 py-2">
                                {cari.aktif ? (
                                  <span className="text-green-600 text-xs">Aktif</span>
                                ) : (
                                  <span className="text-red-600 text-xs">Pasif</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {etaCariler.data.length > 50 && (
                        <div className="p-2 text-center text-xs text-gray-500 bg-gray-50">
                          ve {etaCariler.data.length - 50} tane daha...
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-gray-500 text-center py-4">Cari kart bulunamadi</p>
                )}
              </div>
            )}

            <div className="p-4 border-t bg-gray-50">
              <button
                onClick={() => syncCariMutation.mutate()}
                disabled={syncCariMutation.isPending}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {syncCariMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowRightLeft className="w-4 h-4" />
                )}
                Carileri Senkronize Et
              </button>
            </div>
          </div>

          {/* Stoklar (Urunler) */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="p-4 border-b bg-purple-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Package className="w-6 h-6 text-purple-600" />
                <div>
                  <h2 className="font-semibold text-gray-900">Stok Kartlar (Urunler)</h2>
                  <p className="text-sm text-gray-500">ETA'daki stoklari urun turlerine aktar</p>
                </div>
              </div>
              <button
                onClick={() => setShowStoklar(!showStoklar)}
                className="text-gray-500 hover:text-gray-700"
              >
                {showStoklar ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </button>
            </div>

            {showStoklar && (
              <div className="p-4">
                {isStokLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="w-6 h-6 animate-spin text-purple-500" />
                  </div>
                ) : etaStoklar?.data && etaStoklar.data.length > 0 ? (
                  <>
                    <div className="mb-4 text-sm text-gray-600">
                      ETA'da {etaStoklar.data.length} stok bulundu
                    </div>
                    <div className="max-h-64 overflow-y-auto border rounded-lg">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left">Kod</th>
                            <th className="px-3 py-2 text-left">Ad</th>
                            <th className="px-3 py-2 text-left">Birim</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {etaStoklar.data.slice(0, 50).map((stok, idx) => (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="px-3 py-2 font-mono text-xs">{stok.kod}</td>
                              <td className="px-3 py-2">{stok.ad}</td>
                              <td className="px-3 py-2 text-xs text-gray-500">{stok.birim || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {etaStoklar.data.length > 50 && (
                        <div className="p-2 text-center text-xs text-gray-500 bg-gray-50">
                          ve {etaStoklar.data.length - 50} tane daha...
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-gray-500 text-center py-4">Stok karti bulunamadi</p>
                )}
              </div>
            )}

            <div className="p-4 border-t bg-gray-50">
              <button
                onClick={() => syncStokMutation.mutate()}
                disabled={syncStokMutation.isPending}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                {syncStokMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowRightLeft className="w-4 h-4" />
                )}
                Stoklari Senkronize Et
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tam Senkronizasyon */}
      {isConnected && (
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-lg p-6 text-white">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <ArrowRightLeft className="w-8 h-8" />
              <div>
                <h3 className="font-semibold text-lg">Tam Senkronizasyon</h3>
                <p className="text-indigo-100 text-sm">
                  Tum carileri ve stoklari tek seferde senkronize edin
                </p>
              </div>
            </div>
            <button
              onClick={() => syncAllMutation.mutate()}
              disabled={syncAllMutation.isPending}
              className="flex items-center gap-2 px-6 py-3 bg-white text-indigo-600 rounded-lg font-semibold hover:bg-indigo-50 disabled:opacity-50"
            >
              {syncAllMutation.isPending ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <RefreshCw className="w-5 h-5" />
              )}
              Tumu Senkronize Et
            </button>
          </div>
        </div>
      )}

      {/* Veritabani Kesfi (Gelismis) */}
      {isConnected && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <button
            onClick={() => setShowTables(!showTables)}
            className="w-full p-4 flex items-center justify-between hover:bg-gray-50"
          >
            <div className="flex items-center gap-3">
              <Settings2 className="w-5 h-5 text-gray-400" />
              <span className="font-medium text-gray-700">Gelismis: ETA Tablo Yapisi (Kesif)</span>
            </div>
            {showTables ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
          </button>

          {showTables && (
            <div className="p-4 border-t">
              {isTablesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : etaTables?.tables ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <h4 className="font-medium text-gray-700 mb-2">Tablolar ({etaTables.tables.length})</h4>
                    <div className="max-h-64 overflow-y-auto border rounded-lg">
                      {etaTables.tables.map((table, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedTable(table)}
                          className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 border-b last:border-0 ${
                            selectedTable === table ? 'bg-indigo-50 text-indigo-600' : ''
                          }`}
                        >
                          {table}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    {selectedTable && tableColumns?.columns && (
                      <>
                        <h4 className="font-medium text-gray-700 mb-2">{selectedTable} Kolonlari</h4>
                        <div className="max-h-64 overflow-y-auto border rounded-lg">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr>
                                <th className="px-3 py-2 text-left">Kolon</th>
                                <th className="px-3 py-2 text-left">Tip</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {tableColumns.columns.map((col, idx) => (
                                <tr key={idx} className="hover:bg-gray-50">
                                  <td className="px-3 py-2 font-mono text-xs">{col.name}</td>
                                  <td className="px-3 py-2 text-xs text-gray-500">{col.type}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-gray-500 text-center py-4">Tablo bilgisi alinamadi</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Irsaliye Bilgisi */}
      {isConnected && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-start gap-3">
            <FileText className="w-6 h-6 text-teal-600 mt-1" />
            <div>
              <h3 className="font-semibold text-gray-900">Irsaliye Entegrasyonu</h3>
              <p className="text-sm text-gray-600 mt-1">
                Teslimat tamamlandiginda otomatik olarak ETA'ya satis irsaliyesi olusturulur.
                Irsaliye olusturmak icin:
              </p>
              <ul className="mt-2 text-sm text-gray-600 space-y-1">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-green-500" />
                  Otelin ETA cari kodu tanimli olmali (senkronizasyon yapilmali)
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-green-500" />
                  Urun turlerinin ETA stok kodu tanimli olmali (senkronizasyon yapilmali)
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-green-500" />
                  Teslimat "teslim edildi" durumuna gectiginde irsaliye olusturulur
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
