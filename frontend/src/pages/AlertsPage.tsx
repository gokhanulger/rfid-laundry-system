import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, CheckCheck, Trash2, RefreshCw, Filter } from 'lucide-react';
import { alertsApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import type { Alert, AlertSeverity, AlertType } from '../types';

const severityColors: Record<AlertSeverity, string> = {
  low: 'bg-blue-100 text-blue-800 border-blue-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  high: 'bg-orange-100 text-orange-800 border-orange-200',
  critical: 'bg-red-100 text-red-800 border-red-200',
};

const typeLabels: Record<AlertType, string> = {
  missing_item: 'Kayip Urun',
  dwell_time: 'Bekleme Suresi',
  damaged_item: 'Hasarli Urun',
  stained_item: 'Lekeli Urun',
  high_wash_count: 'Yuksek Yikama Sayisi',
  system: 'Sistem',
};

export function AlertsPage() {
  const [filter, setFilter] = useState<{ severity?: string; unreadOnly?: boolean }>({ unreadOnly: false });
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['alerts', filter],
    queryFn: () => alertsApi.getAll(filter),
  });

  const markReadMutation = useMutation({
    mutationFn: alertsApi.markRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast.success('Uyari okundu olarak isaretlendi');
    },
    onError: (err) => toast.error('Uyari isaretlenemedi', getErrorMessage(err)),
  });

  const markAllReadMutation = useMutation({
    mutationFn: alertsApi.markAllRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast.success('Tum uyarilar okundu olarak isaretlendi');
    },
    onError: (err) => toast.error('Tum uyarilar isaretlenemedi', getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: alertsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      toast.success('Uyari silindi');
    },
    onError: (err) => toast.error('Uyari silinemedi', getErrorMessage(err)),
  });

  const alerts = data?.data || [];
  const unreadCount = alerts.filter(a => !a.isRead).length;

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Uyarilar</h1>
          {unreadCount > 0 && (
            <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">
              {unreadCount} okunmamis
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => markAllReadMutation.mutate()}
            disabled={unreadCount === 0}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          >
            <CheckCheck className="w-4 h-4" />
            Tumunu Okundu Isaretle
          </button>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Yenile
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Filtreler:</span>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={filter.unreadOnly}
            onChange={(e) => setFilter({ ...filter, unreadOnly: e.target.checked })}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-600">Sadece okunmamis</span>
        </label>
        <select
          value={filter.severity || ''}
          onChange={(e) => setFilter({ ...filter, severity: e.target.value || undefined })}
          className="px-3 py-1 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Tum Onem Seviyeleri</option>
          <option value="low">Dusuk</option>
          <option value="medium">Orta</option>
          <option value="high">Yuksek</option>
          <option value="critical">Kritik</option>
        </select>
      </div>

      {/* Alerts List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600">Uyarilar yuklenemedi</p>
          <button onClick={() => refetch()} className="text-red-600 underline mt-2">Tekrar dene</button>
        </div>
      ) : alerts.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <Bell className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-500">Goruntulecek uyari yok</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onMarkRead={() => markReadMutation.mutate(alert.id)}
              onDelete={() => deleteMutation.mutate(alert.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {data?.pagination && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <span className="text-sm text-gray-500">
            Sayfa {data.pagination.page} / {data.pagination.totalPages} ({data.pagination.total} uyari)
          </span>
        </div>
      )}
    </div>
  );
}

function AlertCard({
  alert,
  onMarkRead,
  onDelete,
}: {
  alert: Alert;
  onMarkRead: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`bg-white rounded-lg shadow p-4 border-l-4 ${
        severityColors[alert.severity]
      } ${!alert.isRead ? 'ring-2 ring-blue-200' : ''}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-2 py-0.5 text-xs font-medium rounded ${severityColors[alert.severity]}`}>
              {alert.severity.toUpperCase()}
            </span>
            <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 rounded">
              {typeLabels[alert.type] || alert.type}
            </span>
            {!alert.isRead && (
              <span className="w-2 h-2 bg-blue-500 rounded-full" title="Okunmamis" />
            )}
          </div>
          <h3 className="font-semibold text-gray-900">{alert.title}</h3>
          <p className="text-sm text-gray-600 mt-1">{alert.message}</p>
          {alert.item && (
            <p className="text-xs text-gray-500 mt-2">
              Ilgili Urun: <span className="font-mono">{alert.item.rfidTag}</span>
            </p>
          )}
          <p className="text-xs text-gray-400 mt-2">
            {new Date(alert.createdAt).toLocaleString('tr-TR')}
          </p>
        </div>
        <div className="flex items-center gap-2 ml-4">
          {!alert.isRead && (
            <button
              onClick={onMarkRead}
              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              title="Okundu olarak isaretle"
            >
              <Check className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onDelete}
            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="Sil"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
