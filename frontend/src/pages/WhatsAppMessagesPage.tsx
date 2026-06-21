import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Check,
  AlertCircle,
  Search,
  Phone,
  Building2,
  ArrowLeft,
  UserPlus,
  X,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { notificationApi, settingsApi, type NotificationLog, type NotificationStatus } from '../lib/api';
import type { Tenant } from '../types';

// Backend artik 'tenant' + 'cost' + 'direction' alanlarini donduyor; tipi yerel olarak genisletiyoruz
type LogWithTenant = NotificationLog & {
  tenant?: { id: string; name: string } | null;
  cost?: string | null;
  costUnit?: string | null;
};

// Twilio fiyatlari negatif (giderim) string olarak gelir; absolute alip formatla
function fmtCost(c?: string | null, unit?: string | null): string {
  if (c == null) return '';
  const n = Math.abs(parseFloat(c));
  if (isNaN(n)) return '';
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

const EVENT_LABEL: Record<string, string> = {
  delivery_delivered: 'Temiz Teslim',
  pickup_received: 'Kirli Teslim Alma',
  delivery_created: 'Teslimat Oluşturuldu',
  delivery_packaged: 'Paketlendi',
  delivery_picked_up: 'Yola Çıktı',
  pickup_created: 'Toplama Oluşturuldu',
  alert_new: 'Uyarı',
  daily_summary: 'Günlük Özet',
  inbound_message: 'Gelen Mesaj',
};

const STATUS_BADGE: Record<NotificationStatus, { label: string; icon: any; class: string }> = {
  pending: { label: 'Beklemede', icon: Clock, class: 'text-gray-400' },
  sent: { label: 'Gönderildi', icon: Check, class: 'text-blue-500' },
  delivered: { label: 'İletildi', icon: CheckCircle2, class: 'text-emerald-500' },
  failed: { label: 'Başarısız', icon: XCircle, class: 'text-red-500' },
};

// Telefonu son 10 hane ile normalize et (konusma anahtari)
function phoneKey(raw?: string): string {
  const d = (raw || '').replace(/\D/g, '');
  return d.slice(-10) || raw || '';
}

interface Thread {
  key: string;
  tenantName: string | null;
  phone: string;
  messages: LogWithTenant[]; // createdAt artan
  last: LogWithTenant;
  failedCount: number;
}

function buildThreads(logs: LogWithTenant[]): Thread[] {
  const map = new Map<string, LogWithTenant[]>();
  for (const l of logs) {
    const key = l.tenant?.id || phoneKey(l.recipient);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(l);
  }
  const threads: Thread[] = [];
  for (const [key, msgs] of map.entries()) {
    msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const named = msgs.find((m) => m.tenant?.name);
    threads.push({
      key,
      tenantName: named?.tenant?.name || null,
      phone: msgs[0].recipient,
      messages: msgs,
      last: msgs[msgs.length - 1],
      failedCount: msgs.filter((m) => m.status === 'failed').length,
    });
  }
  threads.sort((a, b) => new Date(b.last.createdAt).getTime() - new Date(a.last.createdAt).getTime());
  return threads;
}

export function WhatsAppMessagesPage() {
  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['notification-logs', 'whatsapp', 'threads'],
    queryFn: () => notificationApi.getLogs({ channel: 'whatsapp', limit: 200, offset: 0 }),
    refetchInterval: 30_000,
  });

  // Atama için otel listesi
  const { data: tenants = [] } = useQuery({
    queryKey: ['tenants', 'for-assign'],
    queryFn: () => settingsApi.getTenants(),
    staleTime: 5 * 60 * 1000,
  });

  const logs = (data?.logs || []) as LogWithTenant[];
  const total = data?.total || 0;

  const threads = useMemo(() => buildThreads(logs), [logs]);

  const filteredThreads = useMemo(() => {
    if (!search) return threads;
    const s = search.toLowerCase();
    return threads.filter((t) =>
      `${t.tenantName || ''} ${t.phone} ${t.last.content}`.toLowerCase().includes(s)
    );
  }, [threads, search]);

  const selected = useMemo(
    () => threads.find((t) => t.key === selectedKey) || null,
    [threads, selectedKey]
  );

  // Sayaçlar (çekilen tüm loglar üzerinden)
  const counts = useMemo(() => {
    const c = { delivered: 0, sent: 0, failed: 0, inbound: 0 };
    logs.forEach((l) => {
      if (l.direction === 'inbound') c.inbound += 1;
      else if (l.status === 'delivered') c.delivered += 1;
      else if (l.status === 'sent') c.sent += 1;
      else if (l.status === 'failed') c.failed += 1;
    });
    return c;
  }, [logs]);
  const totalCost = useMemo(() => sumCost(logs), [logs]);

  // Thread değişince en alta kaydır
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [selectedKey, selected?.messages.length]);

  return (
    <div className="p-4 md:p-6 bg-gray-50 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="mb-4 flex-shrink-0 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <MessageSquare className="w-7 h-7 text-emerald-600" />
            </div>
            WhatsApp Mesajları
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            Otellerle giden/gelen tüm WhatsApp yazışmaları — otel bazında
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

      {/* Stat cards — sabit (sticky) ust kisim, kaymaz */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4 flex-shrink-0">
        <StatCard label="Toplam" count={total} icon={MessageSquare} color="text-gray-600" />
        <StatCard label="İletildi" count={counts.delivered} icon={CheckCircle2} color="text-emerald-600" />
        <StatCard label="Gönderildi" count={counts.sent} icon={Check} color="text-blue-600" />
        <StatCard label="Gelen" count={counts.inbound} icon={ArrowLeft} color="text-indigo-600" />
        <StatCard label="Başarısız" count={counts.failed} icon={XCircle} color="text-red-600" />
        <div className="bg-white rounded-xl border border-gray-200 p-3">
          <div className="flex items-center gap-1.5">
            <span className="text-emerald-600 text-sm font-semibold">$</span>
            <span className="text-xs text-gray-500">Maliyet</span>
          </div>
          <div className="mt-1 text-lg font-bold text-emerald-700">
            {totalCost.sum.toFixed(2)} <span className="text-xs font-normal text-gray-500">{totalCost.unit}</span>
          </div>
        </div>
      </div>

      {/* Conversation layout */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex-1 flex min-h-0">
        {/* Sol: konuşma listesi */}
        <div
          className={`w-full md:w-80 md:flex-shrink-0 border-r border-gray-200 flex-col min-h-0 ${
            selected ? 'hidden md:flex' : 'flex'
          }`}
        >
          <div className="p-3 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Otel veya telefon ara..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-8 text-center text-gray-400">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" /> Yükleniyor...
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                <MessageSquare className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                {logs.length === 0 ? 'Henüz mesaj yok' : 'Eşleşen konuşma yok'}
              </div>
            ) : (
              filteredThreads.map((t) => {
                const isInbound = t.last.direction === 'inbound';
                return (
                  <button
                    key={t.key}
                    onClick={() => setSelectedKey(t.key)}
                    className={`w-full text-left px-3 py-3 border-b border-gray-50 hover:bg-gray-50 flex items-start gap-3 ${
                      selectedKey === t.key ? 'bg-emerald-50' : ''
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-gray-900 text-sm truncate">
                          {t.tenantName || t.phone}
                        </span>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">
                          {formatDistanceToNow(new Date(t.last.createdAt), { addSuffix: false, locale: tr })}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        {isInbound && <ArrowLeft className="w-3 h-3 text-indigo-500 flex-shrink-0" />}
                        <span className="text-xs text-gray-500 truncate">
                          {t.last.content.split('\n')[0]}
                        </span>
                      </div>
                    </div>
                    {t.failedCount > 0 && (
                      <span className="flex-shrink-0 text-[10px] bg-red-100 text-red-600 rounded-full px-1.5 py-0.5 font-medium">
                        {t.failedCount} ✕
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Sağ: seçili konuşma thread'i */}
        <div className={`flex-1 flex-col min-h-0 ${selected ? 'flex' : 'hidden md:flex'}`}>
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
              <div className="text-center">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-200" />
                Bir konuşma seçin
              </div>
            </div>
          ) : (
            <>
              {/* Thread başlığı */}
              <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3 bg-gray-50">
                <button
                  onClick={() => setSelectedKey(null)}
                  className="md:hidden p-1 hover:bg-gray-200 rounded"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <Building2 className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-gray-900 truncate">
                    {selected.tenantName || 'Bilinmeyen Otel'}
                  </div>
                  <div className="text-xs text-gray-500 flex items-center gap-1 font-mono">
                    <Phone className="w-3 h-3" /> {selected.phone}
                  </div>
                </div>
                <AssignHotel
                  phone={selected.phone}
                  assigned={!!selected.tenantName}
                  tenants={tenants}
                  onAssigned={() => {
                    queryClient.invalidateQueries({ queryKey: ['notification-logs', 'whatsapp', 'threads'] });
                  }}
                />
              </div>

              {/* Mesaj baloncukları */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#efeae2]">
                {selected.messages.map((m) => {
                  const inbound = m.direction === 'inbound';
                  const sb = STATUS_BADGE[m.status];
                  const StatusIcon = sb?.icon || AlertCircle;
                  const cost = fmtCost(m.cost, m.costUnit);
                  return (
                    <div key={m.id} className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
                      <div
                        className={`max-w-[78%] rounded-lg px-3 py-2 shadow-sm ${
                          inbound ? 'bg-white' : 'bg-[#d9fdd3]'
                        }`}
                      >
                        {!inbound && (
                          <div className="text-[10px] font-semibold text-emerald-700/70 mb-0.5">
                            {EVENT_LABEL[m.event] || m.event}
                          </div>
                        )}
                        <div className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                          {m.content}
                        </div>
                        {m.errorMessage && (
                          <div className="mt-1 text-[11px] text-red-600 bg-red-50 rounded px-1.5 py-0.5">
                            Hata: {m.errorMessage}
                          </div>
                        )}
                        <div
                          className={`flex items-center gap-1.5 mt-1 text-[10px] text-gray-400 ${
                            inbound ? 'justify-start' : 'justify-end'
                          }`}
                        >
                          <span>{format(new Date(m.createdAt), 'dd MMM HH:mm', { locale: tr })}</span>
                          {cost && <span className="text-emerald-600 font-mono">{cost}</span>}
                          {!inbound && sb && (
                            <span className={`flex items-center gap-0.5 ${sb.class}`}>
                              <StatusIcon className="w-3 h-3" />
                              {sb.label}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={threadEndRef} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AssignHotel({
  phone,
  assigned,
  tenants,
  onAssigned,
}: {
  phone: string;
  assigned: boolean;
  tenants: Tenant[];
  onAssigned: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return tenants.filter((t) => (t.name || '').toLowerCase().includes(s)).slice(0, 50);
  }, [tenants, q]);

  const assign = async (tenantId: string) => {
    setSaving(true);
    try {
      await notificationApi.assignThread(phone, tenantId);
      setOpen(false);
      setQ('');
      onAssigned();
    } catch {
      alert('Atama başarısız oldu');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${
          assigned
            ? 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            : 'bg-emerald-600 text-white hover:bg-emerald-700'
        }`}
      >
        <UserPlus className="w-4 h-4" />
        {assigned ? 'Değiştir' : 'Otele Ata'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-20 flex flex-col max-h-80">
            <div className="p-2 border-b border-gray-100 flex items-center gap-2">
              <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Otel ara..."
                className="flex-1 text-sm outline-none min-w-0"
              />
              <button onClick={() => setOpen(false)} className="flex-shrink-0">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              {filtered.length === 0 ? (
                <div className="p-3 text-sm text-gray-400 text-center">Otel bulunamadı</div>
              ) : (
                filtered.map((t) => (
                  <button
                    key={t.id}
                    disabled={saving}
                    onClick={() => assign(t.id)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 disabled:opacity-50 flex items-center gap-2"
                  >
                    <Building2 className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <span className="truncate">{t.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
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
    <div className="bg-white rounded-xl border border-gray-200 p-3">
      <div className="flex items-center gap-1.5">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className={`mt-1 text-xl font-bold ${color}`}>{count}</div>
    </div>
  );
}
