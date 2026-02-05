import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  Building2,
  Package,
  Truck,
  ArrowUpCircle,
  AlertTriangle,
  Clock,
  FileText,
  RefreshCw,
  Home,
  Loader2,
  ChevronRight,
  Activity,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { portalApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useRealtime } from '../hooks/useRealtime';
import { useSocket } from '../contexts/SocketContext';

export function CustomerPortalPage() {
  const { user } = useAuth();
  const { isConnected } = useSocket();

  // Real-time updates - auto-invalidates queries when events arrive
  useRealtime({});

  const { data: summary, isLoading, error, refetch } = useQuery({
    queryKey: ['portal', 'summary'],
    queryFn: portalApi.getSummary,
    refetchInterval: isConnected ? false : 30000, // Only poll if WebSocket not connected
  });

  const { data: activity } = useQuery({
    queryKey: ['portal', 'activity'],
    queryFn: () => portalApi.getActivity(10),
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Portal yukleniyor...</p>
        </div>
      </div>
    );
  }

  if (error) {
    const axiosError = error as any;
    const status = axiosError?.response?.status;
    const errorMessage = axiosError?.response?.data?.error || axiosError?.message || 'Bilinmeyen hata';

    let userMessage = 'Portal yuklenirken hata olustu';
    let subMessage = '';

    if (status === 401) {
      userMessage = 'Oturum suresi dolmus';
      subMessage = 'Lutfen tekrar giris yapin';
    } else if (status === 403) {
      if (errorMessage.includes('tenant')) {
        userMessage = 'Otel atamasi yapilmamis';
        subMessage = 'Hesabiniza bir otel atanmasi gerekiyor. Lutfen yonetici ile iletisime gecin.';
      } else {
        userMessage = 'Erisim yetkiniz yok';
        subMessage = 'Portal icin hotel_owner veya system_admin rolu gerekli';
      }
    } else if (status === 500) {
      userMessage = 'Sunucu hatasi';
      subMessage = 'Lutfen daha sonra tekrar deneyin';
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md px-4">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto" />
          <p className="mt-4 text-lg font-medium text-gray-900">{userMessage}</p>
          {subMessage && <p className="mt-2 text-gray-600">{subMessage}</p>}
          <p className="mt-2 text-sm text-gray-400">Hata: {errorMessage}</p>
          <div className="mt-6 space-x-3">
            <button
              onClick={() => refetch()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Tekrar Dene
            </button>
            <button
              onClick={() => window.location.href = '#/login'}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
            >
              Giris Yap
            </button>
          </div>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    'pickup': 'bg-orange-100 text-orange-800',
    'delivery': 'bg-green-100 text-green-800',
  };

  return (
    <div className="p-4 md:p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Hosgeldiniz, {user?.firstName}!
            </h1>
            {summary?.hotel && (
              <p className="text-gray-600 mt-1 flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                {summary.hotel.name}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Connection status indicator */}
            <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${isConnected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {isConnected ? 'Canli' : 'Offline'}
            </div>
            <button
              onClick={() => refetch()}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
              title="Yenile"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Item Status Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Package className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{summary?.items.total || 0}</p>
              <p className="text-sm text-gray-500">Toplam Urun</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <Home className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{summary?.items.atHotel || 0}</p>
              <p className="text-sm text-gray-500">Otelde</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <RefreshCw className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{summary?.items.atLaundry || 0}</p>
              <p className="text-sm text-gray-500">Camasirhanede</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 rounded-lg">
              <Truck className="w-6 h-6 text-orange-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{summary?.items.inTransit || 0}</p>
              <p className="text-sm text-gray-500">Yolda</p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
        {/* Delivery Stats */}
        <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Truck className="w-5 h-5 text-green-600" />
              Teslimatlar
            </h3>
            <Link
              to="/portal/deliveries"
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              Tumu <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-green-600">{summary?.deliveries.today || 0}</p>
              <p className="text-xs text-gray-500">Bugun</p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-700">{summary?.deliveries.thisWeek || 0}</p>
              <p className="text-xs text-gray-500">Bu Hafta</p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-700">{summary?.deliveries.thisMonth || 0}</p>
              <p className="text-xs text-gray-500">Bu Ay</p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-700">{summary?.deliveries.total || 0}</p>
              <p className="text-xs text-gray-500">Toplam</p>
            </div>
          </div>
        </div>

        {/* Pickup Stats */}
        <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <ArrowUpCircle className="w-5 h-5 text-orange-600" />
              Toplamalar
            </h3>
            <Link
              to="/portal/pickups"
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              Tumu <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-orange-600">{summary?.pickups.today || 0}</p>
              <p className="text-xs text-gray-500">Bugun</p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-700">{summary?.pickups.thisWeek || 0}</p>
              <p className="text-xs text-gray-500">Bu Hafta</p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-700">{summary?.pickups.thisMonth || 0}</p>
              <p className="text-xs text-gray-500">Bu Ay</p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-700">{summary?.pickups.total || 0}</p>
              <p className="text-xs text-gray-500">Toplam</p>
            </div>
          </div>
        </div>

        {/* Item Health */}
        <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-600" />
              Urun Durumu
            </h3>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Ortalama Yikama</span>
              <span className="font-semibold">{summary?.items.avgWashCount || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 flex items-center gap-1">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                Hasarli
              </span>
              <span className="font-semibold text-red-600">{summary?.items.damaged || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 flex items-center gap-1">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                Lekeli
              </span>
              <span className="font-semibold text-yellow-600">{summary?.items.stained || 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Two Column Layout */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Pending Deliveries */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-600" />
              Bekleyen Teslimatlar
            </h3>
          </div>
          <div className="p-4">
            {summary?.deliveries.pending && summary.deliveries.pending.length > 0 ? (
              <div className="space-y-3">
                {summary.deliveries.pending.map((delivery) => (
                  <div
                    key={delivery.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div>
                      <p className="font-medium text-gray-900">{delivery.barcode}</p>
                      <p className="text-sm text-gray-500">
                        {formatDistanceToNow(new Date(delivery.createdAt), {
                          addSuffix: true,
                          locale: tr,
                        })}
                      </p>
                    </div>
                    <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">
                      {delivery.status === 'packaged' ? 'Paketlendi' :
                       delivery.status === 'in_transit' ? 'Yolda' :
                       delivery.status === 'picked_up' ? 'Alinacak' : delivery.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-gray-500 py-4">Bekleyen teslimat yok</p>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Activity className="w-5 h-5 text-purple-600" />
              Son Aktiviteler
            </h3>
          </div>
          <div className="p-4">
            {activity && activity.length > 0 ? (
              <div className="space-y-3">
                {activity.slice(0, 5).map((item) => (
                  <div
                    key={`${item.type}-${item.id}`}
                    className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg"
                  >
                    <div className={`p-2 rounded-lg ${statusColors[item.type]}`}>
                      {item.type === 'pickup' ? (
                        <ArrowUpCircle className="w-4 h-4" />
                      ) : (
                        <Truck className="w-4 h-4" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-sm">{item.title}</p>
                      <p className="text-xs text-gray-500 truncate">{item.description}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {formatDistanceToNow(new Date(item.date), {
                          addSuffix: true,
                          locale: tr,
                        })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-gray-500 py-4">Henuz aktivite yok</p>
            )}
          </div>
        </div>
      </div>

      {/* Attention Items */}
      {summary?.attentionItems && summary.attentionItems.length > 0 && (
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
              Dikkat Gerektiren Urunler
            </h3>
            <Link
              to="/items"
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              Tumu <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="pb-2 font-medium">RFID Tag</th>
                  <th className="pb-2 font-medium">Tur</th>
                  <th className="pb-2 font-medium">Yikama</th>
                  <th className="pb-2 font-medium">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {summary.attentionItems.slice(0, 5).map((item) => (
                  <tr key={item.id}>
                    <td className="py-2 font-mono text-xs">{item.rfidTag}</td>
                    <td className="py-2">{item.itemType || '-'}</td>
                    <td className="py-2">{item.washCount}</td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        {item.isDamaged && (
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
                            Hasarli
                          </span>
                        )}
                        {item.isStained && (
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-100 text-yellow-700">
                            Lekeli
                          </span>
                        )}
                        {item.washCount > 50 && !item.isDamaged && !item.isStained && (
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-orange-100 text-orange-700">
                            Yuksek Yikama
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quick Links */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <Link
          to="/portal/deliveries"
          className="flex items-center gap-3 p-4 bg-white rounded-xl shadow-sm border border-gray-100 hover:border-blue-300 transition-colors"
        >
          <Truck className="w-6 h-6 text-green-600" />
          <span className="font-medium text-gray-700">Teslimat Gecmisi</span>
        </Link>
        <Link
          to="/portal/pickups"
          className="flex items-center gap-3 p-4 bg-white rounded-xl shadow-sm border border-gray-100 hover:border-blue-300 transition-colors"
        >
          <ArrowUpCircle className="w-6 h-6 text-orange-600" />
          <span className="font-medium text-gray-700">Toplama Gecmisi</span>
        </Link>
        <Link
          to="/portal/waybills"
          className="flex items-center gap-3 p-4 bg-white rounded-xl shadow-sm border border-gray-100 hover:border-blue-300 transition-colors"
        >
          <FileText className="w-6 h-6 text-blue-600" />
          <span className="font-medium text-gray-700">Irsaliyeler</span>
        </Link>
        <Link
          to="/items"
          className="flex items-center gap-3 p-4 bg-white rounded-xl shadow-sm border border-gray-100 hover:border-blue-300 transition-colors"
        >
          <Package className="w-6 h-6 text-purple-600" />
          <span className="font-medium text-gray-700">Urun Listesi</span>
        </Link>
      </div>
    </div>
  );
}
