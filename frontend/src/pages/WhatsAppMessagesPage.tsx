import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  MessageSquare,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Check,
  AlertCircle,
  X,
  Search,
  Phone,
  Building2,
  Copy,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { notificationApi, type NotificationLog, type NotificationStatus } from '../lib/api';

// Backend artik 'tenant' + 'cost' alanlarini donduyor; tipi yerel olarak genisletiyoruz
type LogWithTenant = NotificationLog & {
  tenant?: { id: string; name: string } | null;
  cost?: string | null;
  costUnit?: string | null;
};

// Twilio fiyatlari negatif (giderim) string olarak gelir; absolute alip formatla
function fmtCost(c?: string | null, unit?: string | null): string {
  if (c == null) return '—';
  const n = Math.abs(parseFloat(c));
  if (isNaN(n)) return '—';
  return `${n.toFixed(4)} ${unit || ''}`.trim();
}

function sumCost(logs: LogWithTenant[]): { sum: number; unit: string } {
  let sum = 0;
  let unit = 'USD';
  logs.forEach((l) => {
    if (l.cost != null) {
      const n = Math.abs(parseFloat(l.cost));
      if (!isNaN(n)) {
        sum += n;
        if (l.costUnit) unit = l.costUnit;
      }
    }
  });
  return { sum, unit };
}

const EVENT_LABEL: Record<string, { label: string; color: string }> = {
  delivery_delivered: { label: 'Temiz Teslim', color: 'bg-emerald-100 text-emerald-800' },
  pickup_received: { label: 'Kirli Teslim Alma', color: 'bg-amber-100 text-amber-800' },
  delivery_created: { label: 'Teslimat Olusturuldu', color: 'bg-blue-100 text-blue-800' },
  delivery_packaged: { label: 'Paketlendi', color: 'bg-blue-100 text-blue-800' },
  delivery_picked_up: { label: 'Yola Cikti', color: 'bg-blue-100 text-blue-800' },
  pickup_created: { label: 'Toplama Olusturuldu', color: 'bg-amber-100 text-amber-800' },
  alert_new: { label: 'Uyari', color: 'bg-red-100 text-red-800' },
  daily_summary: { label: 'Gunluk Ozet', color: 'bg-gray-100 text-gray-800' },
};

const STATUS_BADGE: Record<NotificationStatus, { label: string; icon: any; class: string }> = {
  pending: { label: 'Beklemede', icon: Clock, class: 'bg-gray-100 text-gray-700' },
  sent: { label: 'Gonderildi', icon: Check, class: 'bg-blue-100 text-blue-700' },
  delivered: { label: 'Iletildi', icon: CheckCircle2, class: 'bg-emerald-100 text-emerald-700' },
  failed: { label: 'Basarisiz', icon: XCircle, class: 'bg-red-100 text-red-700' },
};

export function WhatsAppMessagesPage() {
  const [statusFilter, setStatusFilter] = useState<'' | NotificationStatus>('');
  const [eventFilter, setEventFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<LogWithTenant | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['notification-logs', 'whatsapp', statusFilter, page],
    queryFn: () =>
      notificationApi.getLogs({
        channel: 'whatsapp',
        status: statusFilter || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    refetchInterval: 30_000, // 30 saniyede bir tazele (delivery callback durum guncellesin)
  });

  const logs = (data?.logs || []) as LogWithTenant[];
  const total = data?.total || 0;

  // Istemci tarafi olay/arama filtresi (server zaten status'u filtreliyor)
  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (eventFilter && l.event !== eventFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        const blob = `${l.recipient} ${l.tenant?.name || ''} ${l.content} ${l.externalId || ''}`.toLowerCase();
        if (!blob.includes(s)) return false;
      }
      return true;
    });
  }, [logs, eventFilter, search]);

  // Sayac istatistikleri
  const counts = useMemo(() => {
    const c = { total: logs.length, sent: 0, delivered: 0, failed: 0, pending: 0 };
    logs.forEach((l) => {
      if (l.status in c) (c as any)[l.status] += 1;
    });
    return c;
  }, [logs]);

  // Toplam maliyet (sayfa icindeki loglar uzerinden)
  const totalCost = useMemo(() => sumCost(logs), [logs]);

  return (
    <div className="p-4 md:p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <MessageSquare className="w-7 h-7 text-emerald-600" />
            </div>
            WhatsApp Mesajları
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            Otellere gönderilen tüm WhatsApp bildirimlerinin takibi
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          Yenile
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <StatCard label="Toplam" count={total} icon={MessageSquare} color="text-gray-600" />
        <StatCard label="İletildi" count={counts.delivered} icon={CheckCircle2} color="text-emerald-600" />
        <StatCard label="Gönderildi" count={counts.sent} icon={Check} color="text-blue-600" />
        <StatCard label="Beklemede" count={counts.pending} icon={Clock} color="text-gray-500" />
        <StatCard label="Başarısız" count={counts.failed} icon={XCircle} color="text-red-600" />
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2">
            <span className="text-emerald-600 text-sm font-semibold">$</span>
            <span className="text-xs text-gray-500">Toplam Maliyet</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-700">
            {totalCost.sum.toFixed(4)} <span className="text-sm font-normal text-gray-500">{totalCost.unit}</span>
          </div>
          <div className="text-[10px] text-gray-400 mt-0.5">bu sayfadaki {logs.length} mesaj</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Otel, telefon, içerik ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setPage(0);
            setStatusFilter(e.target.value as any);
          }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
        >
          <option value="">Tüm Durumlar</option>
          <option value="delivered">İletildi</option>
          <option value="sent">Gönderildi</option>
          <option value="pending">Beklemede</option>
          <option value="failed">Başarısız</option>
        </select>
        <select
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
        >
          <option value="">Tüm Olaylar</option>
          <option value="delivery_delivered">Temiz Teslim</option>
          <option value="pickup_received">Kirli Teslim Alma</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-gray-500">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
            Yükleniyor...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            {logs.length === 0 ? 'Henüz WhatsApp mesajı gönderilmedi' : 'Filtreyle eşleşen mesaj yok'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-gray-600 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 font-medium">Tarih</th>
                  <th className="px-4 py-3 font-medium">Otel</th>
                  <th className="px-4 py-3 font-medium">Alıcı</th>
                  <th className="px-4 py-3 font-medium">Olay</th>
                  <th className="px-4 py-3 font-medium">Durum</th>
                  <th className="px-4 py-3 font-medium text-right">Maliyet</th>
                  <th className="px-4 py-3 font-medium">Mesaj</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((log) => {
                  const StatusIcon = STATUS_BADGE[log.status]?.icon || AlertCircle;
                  const ev = EVENT_LABEL[log.event] || { label: log.event, color: 'bg-gray-100 text-gray-800' };
                  return (
                    <tr
                      key={log.id}
                      onClick={() => setSelected(log)}
                      className="hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        <div>{format(new Date(log.createdAt), 'dd MMM HH:mm', { locale: tr })}</div>
                        <div className="text-xs text-gray-400">
                          {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true, locale: tr })}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {log.tenant?.name || <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{log.recipient}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${ev.color}`}>
                          {ev.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                            STATUS_BADGE[log.status]?.class || 'bg-gray-100'
                          }`}
                        >
                          <StatusIcon className="w-3 h-3" />
                          {STATUS_BADGE[log.status]?.label || log.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-gray-700 whitespace-nowrap">
                        {fmtCost(log.cost, log.costUnit)}
                      </td>
                      <td className="px-4 py-3 text-gray-600 max-w-md truncate">
                        {log.errorMessage ? (
                          <span className="text-red-600">{log.errorMessage}</span>
                        ) : (
                          log.content.split('\n')[0]
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="border-t border-gray-100 px-4 py-3 flex items-center justify-between text-sm">
            <span className="text-gray-500">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} / {total}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-50"
              >
                Önceki
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * PAGE_SIZE >= total}
                className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-50"
              >
                Sonraki
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selected && <MessageDetailModal log={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function StatCard({
  label,
  count,
  icon: Icon,
  color,
}: {
  label: string;
  count: number;
  icon: any;
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className={`mt-2 text-2xl font-bold ${color}`}>{count}</div>
    </div>
  );
}

function MessageDetailModal({ log, onClose }: { log: LogWithTenant; onClose: () => void }) {
  const ev = EVENT_LABEL[log.event] || { label: log.event, color: 'bg-gray-100 text-gray-800' };
  const StatusIcon = STATUS_BADGE[log.status]?.icon || AlertCircle;
  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-emerald-600" />
            Mesaj Detayı
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field icon={Building2} label="Otel" value={log.tenant?.name || '—'} />
            <Field icon={Phone} label="Alıcı" value={log.recipient} />
            <Field
              label="Olay"
              value={
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ev.color}`}>
                  {ev.label}
                </span>
              }
            />
            <Field
              label="Durum"
              value={
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                    STATUS_BADGE[log.status]?.class || 'bg-gray-100'
                  }`}
                >
                  <StatusIcon className="w-3 h-3" />
                  {STATUS_BADGE[log.status]?.label || log.status}
                </span>
              }
            />
            <Field
              label="Oluşturulma"
              value={format(new Date(log.createdAt), 'dd MMM yyyy HH:mm:ss', { locale: tr })}
            />
            {log.sentAt && (
              <Field
                label="Gönderim"
                value={format(new Date(log.sentAt), 'dd MMM yyyy HH:mm:ss', { locale: tr })}
              />
            )}
            {log.deliveredAt && (
              <Field
                label="İletim"
                value={format(new Date(log.deliveredAt), 'dd MMM yyyy HH:mm:ss', { locale: tr })}
              />
            )}
            {log.cost && (
              <Field
                label="Maliyet"
                value={
                  <span className="font-mono font-semibold text-emerald-700">
                    {fmtCost(log.cost, log.costUnit)}
                  </span>
                }
              />
            )}
          </div>

          {log.errorMessage && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="text-xs font-semibold text-red-700 mb-1">Hata</div>
              <div className="text-sm text-red-800">{log.errorMessage}</div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-gray-600">Mesaj İçeriği</span>
              <button
                onClick={() => navigator.clipboard?.writeText(log.content)}
                className="text-xs text-gray-500 hover:text-emerald-600 flex items-center gap-1"
              >
                <Copy className="w-3 h-3" /> Kopyala
              </button>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 whitespace-pre-wrap text-sm text-gray-800 font-sans">
              {log.content}
            </div>
          </div>

          {log.externalId && (
            <div className="text-xs text-gray-400 font-mono">
              Mesaj ID: {log.externalId}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  value,
}: {
  icon?: any;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs text-gray-500 flex items-center gap-1 mb-0.5">
        {Icon && <Icon className="w-3 h-3" />}
        {label}
      </div>
      <div className="text-sm text-gray-900">{value}</div>
    </div>
  );
}
