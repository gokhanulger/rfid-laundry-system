import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  notificationApi,
  settingsApi,
  NotificationChannel,
  NotificationEvent,
  NotificationSetting,
  NotificationTemplate,
} from '../lib/api';
import type { Tenant } from '../types';
import { useToast } from '../components/Toast';
import {
  Bell,
  MessageSquare,
  Mail,
  Webhook,
  Settings,
  FileText,
  History,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Send,
  Edit2,
  Save,
  RefreshCw,
} from 'lucide-react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';

// Event labels in Turkish
const eventLabels: Record<NotificationEvent, string> = {
  delivery_created: 'Teslimat Oluşturuldu',
  delivery_packaged: 'Teslimat Paketlendi',
  delivery_picked_up: 'Teslimat Yola Çıktı',
  delivery_delivered: 'Teslimat Tamamlandı',
  pickup_created: 'Toplama Oluşturuldu',
  pickup_received: 'Toplama Tamamlandı',
  daily_summary: 'Günlük Özet',
  alert_new: 'Yeni Uyarı',
};

// Channel icons and labels
const channelConfig: Record<NotificationChannel, { icon: any; label: string; color: string }> = {
  whatsapp: { icon: MessageSquare, label: 'WhatsApp', color: 'text-green-500' },
  sms: { icon: MessageSquare, label: 'SMS', color: 'text-blue-500' },
  email: { icon: Mail, label: 'E-posta', color: 'text-purple-500' },
  webhook: { icon: Webhook, label: 'Webhook', color: 'text-orange-500' },
};

// Status colors
const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  sent: 'bg-blue-100 text-blue-800',
  delivered: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

export default function NotificationSettingsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'settings' | 'templates' | 'logs'>('settings');
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [expandedChannel, setExpandedChannel] = useState<NotificationChannel | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<NotificationTemplate | null>(null);
  const [testRecipient, setTestRecipient] = useState('');
  const [testChannel, setTestChannel] = useState<NotificationChannel>('whatsapp');

  // Fetch tenants
  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['tenants'],
    queryFn: settingsApi.getTenants,
  });

  // Fetch notification settings for selected tenant
  const { data: settingsData, isLoading: loadingSettings } = useQuery({
    queryKey: ['notification-settings', selectedTenantId],
    queryFn: () => notificationApi.getSettings(selectedTenantId),
    enabled: !!selectedTenantId,
  });

  // Fetch templates
  const { data: templates = [], isLoading: loadingTemplates } = useQuery({
    queryKey: ['notification-templates'],
    queryFn: notificationApi.getTemplates,
  });

  // Fetch logs
  const { data: logsData, isLoading: loadingLogs } = useQuery({
    queryKey: ['notification-logs', selectedTenantId],
    queryFn: () => notificationApi.getLogs({ tenantId: selectedTenantId || undefined, limit: 50 }),
  });

  // Fetch stats
  const { data: stats } = useQuery({
    queryKey: ['notification-stats', selectedTenantId],
    queryFn: () => notificationApi.getStats(selectedTenantId || undefined),
  });

  // Save settings mutation
  const saveSettingsMutation = useMutation({
    mutationFn: ({ tenantId, settings }: { tenantId: string; settings: Partial<NotificationSetting> }) =>
      notificationApi.saveSettings(tenantId, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-settings'] });
      toast.success('Ayarlar kaydedildi');
    },
    onError: () => {
      toast.error('Ayarlar kaydedilemedi');
    },
  });

  // Update template mutation
  const updateTemplateMutation = useMutation({
    mutationFn: ({ id, template }: { id: string; template: Partial<NotificationTemplate> }) =>
      notificationApi.updateTemplate(id, template),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-templates'] });
      setEditingTemplate(null);
      toast.success('Şablon güncellendi');
    },
    onError: () => {
      toast.error('Şablon güncellenemedi');
    },
  });

  // Send test mutation
  const sendTestMutation = useMutation({
    mutationFn: () => notificationApi.sendTest(selectedTenantId, testChannel, testRecipient),
    onSuccess: (result) => {
      if (result.success) {
        toast.success('Test bildirimi gönderildi');
      } else {
        toast.error(result.error || 'Test gönderilemedi');
      }
    },
    onError: () => {
      toast.error('Test gönderilemedi');
    },
  });

  // Find setting for a channel
  const getSettingForChannel = (channel: NotificationChannel): NotificationSetting | undefined => {
    return settingsData?.settings.find((s) => s.channel === channel);
  };

  // Toggle event for a channel
  const toggleEvent = (channel: NotificationChannel, event: NotificationEvent) => {
    const setting = getSettingForChannel(channel);
    const currentEvents = setting?.events || [];
    const newEvents = currentEvents.includes(event)
      ? currentEvents.filter((e) => e !== event)
      : [...currentEvents, event];

    saveSettingsMutation.mutate({
      tenantId: selectedTenantId,
      settings: {
        channel,
        events: newEvents,
        isEnabled: setting?.isEnabled ?? true,
      },
    });
  };

  // Toggle channel enabled
  const toggleChannelEnabled = (channel: NotificationChannel) => {
    const setting = getSettingForChannel(channel);
    saveSettingsMutation.mutate({
      tenantId: selectedTenantId,
      settings: {
        channel,
        isEnabled: !setting?.isEnabled,
        events: setting?.events || [],
      },
    });
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Bell className="w-6 h-6" />
          Bildirim Ayarları
        </h1>
        <p className="text-gray-600 mt-1">
          Otel bildirimlerini yapılandırın (WhatsApp, Webhook)
        </p>
      </div>

      {/* Tenant Selector */}
      <div className="mb-6 bg-white rounded-lg shadow p-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Otel Seçin</label>
        <select
          value={selectedTenantId}
          onChange={(e) => setSelectedTenantId(e.target.value)}
          className="w-full max-w-md border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">Otel seçin...</option>
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name}
            </option>
          ))}
        </select>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {stats.byStatus.map((s) => (
            <div key={s.status} className="bg-white rounded-lg shadow p-4">
              <div className="flex items-center justify-between">
                <span className="text-gray-600 capitalize">{s.status}</span>
                <span className={`px-2 py-1 rounded text-sm ${statusColors[s.status]}`}>
                  {s.count}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-6 py-3 text-sm font-medium border-b-2 ${
                activeTab === 'settings'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Settings className="w-4 h-4 inline mr-2" />
              Kanal Ayarları
            </button>
            <button
              onClick={() => setActiveTab('templates')}
              className={`px-6 py-3 text-sm font-medium border-b-2 ${
                activeTab === 'templates'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <FileText className="w-4 h-4 inline mr-2" />
              Şablonlar
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`px-6 py-3 text-sm font-medium border-b-2 ${
                activeTab === 'logs'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <History className="w-4 h-4 inline mr-2" />
              Gönderim Geçmişi
            </button>
          </nav>
        </div>

        <div className="p-6">
          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <div>
              {!selectedTenantId ? (
                <div className="text-center py-12 text-gray-500">
                  Lütfen önce bir otel seçin
                </div>
              ) : loadingSettings ? (
                <div className="text-center py-12">
                  <RefreshCw className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                </div>
              ) : (
                <div className="space-y-4">
                  {/* WhatsApp Channel */}
                  <div className="border rounded-lg">
                    <button
                      onClick={() => setExpandedChannel(expandedChannel === 'whatsapp' ? null : 'whatsapp')}
                      className="w-full flex items-center justify-between p-4 hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <MessageSquare className="w-5 h-5 text-green-500" />
                        <span className="font-medium">WhatsApp Business API</span>
                        {getSettingForChannel('whatsapp')?.isEnabled && (
                          <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded">Aktif</span>
                        )}
                      </div>
                      {expandedChannel === 'whatsapp' ? (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-gray-400" />
                      )}
                    </button>

                    {expandedChannel === 'whatsapp' && (
                      <div className="border-t p-4 space-y-4">
                        {/* Enable toggle */}
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-700">Aktif</span>
                          <button
                            onClick={() => toggleChannelEnabled('whatsapp')}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              getSettingForChannel('whatsapp')?.isEnabled ? 'bg-green-500' : 'bg-gray-300'
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                getSettingForChannel('whatsapp')?.isEnabled ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>

                        {/* WhatsApp Settings */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Meta Phone Number ID
                            </label>
                            <input
                              type="text"
                              placeholder="123456789012345"
                              defaultValue={getSettingForChannel('whatsapp')?.whatsappPhoneId || ''}
                              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                              onBlur={(e) => {
                                saveSettingsMutation.mutate({
                                  tenantId: selectedTenantId,
                                  settings: {
                                    channel: 'whatsapp',
                                    whatsappPhoneId: e.target.value,
                                  },
                                });
                              }}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Access Token
                            </label>
                            <input
                              type="password"
                              placeholder="EAAx..."
                              defaultValue={getSettingForChannel('whatsapp')?.whatsappAccessToken || ''}
                              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                              onBlur={(e) => {
                                saveSettingsMutation.mutate({
                                  tenantId: selectedTenantId,
                                  settings: {
                                    channel: 'whatsapp',
                                    whatsappAccessToken: e.target.value,
                                  },
                                });
                              }}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Alıcı Telefon (varsayılan)
                            </label>
                            <input
                              type="text"
                              placeholder="+905xxxxxxxxx"
                              defaultValue={getSettingForChannel('whatsapp')?.whatsappRecipient || ''}
                              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                              onBlur={(e) => {
                                saveSettingsMutation.mutate({
                                  tenantId: selectedTenantId,
                                  settings: {
                                    channel: 'whatsapp',
                                    whatsappRecipient: e.target.value,
                                  },
                                });
                              }}
                            />
                          </div>
                        </div>

                        {/* Events */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Bildirim Olayları
                          </label>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            {(Object.keys(eventLabels) as NotificationEvent[]).map((event) => {
                              const isEnabled = getSettingForChannel('whatsapp')?.events?.includes(event);
                              return (
                                <button
                                  key={event}
                                  onClick={() => toggleEvent('whatsapp', event)}
                                  className={`flex items-center gap-2 px-3 py-2 rounded border text-sm ${
                                    isEnabled
                                      ? 'bg-green-50 border-green-300 text-green-700'
                                      : 'bg-gray-50 border-gray-200 text-gray-600'
                                  }`}
                                >
                                  {isEnabled ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                                  {eventLabels[event]}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Webhook Channel */}
                  <div className="border rounded-lg">
                    <button
                      onClick={() => setExpandedChannel(expandedChannel === 'webhook' ? null : 'webhook')}
                      className="w-full flex items-center justify-between p-4 hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <Webhook className="w-5 h-5 text-orange-500" />
                        <span className="font-medium">Webhook</span>
                        {getSettingForChannel('webhook')?.isEnabled && (
                          <span className="px-2 py-0.5 bg-orange-100 text-orange-800 text-xs rounded">Aktif</span>
                        )}
                      </div>
                      {expandedChannel === 'webhook' ? (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-gray-400" />
                      )}
                    </button>

                    {expandedChannel === 'webhook' && (
                      <div className="border-t p-4 space-y-4">
                        {/* Enable toggle */}
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-700">Aktif</span>
                          <button
                            onClick={() => toggleChannelEnabled('webhook')}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              getSettingForChannel('webhook')?.isEnabled ? 'bg-orange-500' : 'bg-gray-300'
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                getSettingForChannel('webhook')?.isEnabled ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>

                        {/* Webhook Settings */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Webhook URL
                            </label>
                            <input
                              type="url"
                              placeholder="https://your-server.com/webhook"
                              defaultValue={getSettingForChannel('webhook')?.webhookUrl || ''}
                              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                              onBlur={(e) => {
                                saveSettingsMutation.mutate({
                                  tenantId: selectedTenantId,
                                  settings: {
                                    channel: 'webhook',
                                    webhookUrl: e.target.value,
                                  },
                                });
                              }}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Secret (opsiyonel)
                            </label>
                            <input
                              type="password"
                              placeholder="HMAC imza için secret"
                              defaultValue={getSettingForChannel('webhook')?.webhookSecret || ''}
                              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                              onBlur={(e) => {
                                saveSettingsMutation.mutate({
                                  tenantId: selectedTenantId,
                                  settings: {
                                    channel: 'webhook',
                                    webhookSecret: e.target.value,
                                  },
                                });
                              }}
                            />
                          </div>
                        </div>

                        {/* Events */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Bildirim Olayları
                          </label>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            {(Object.keys(eventLabels) as NotificationEvent[]).map((event) => {
                              const isEnabled = getSettingForChannel('webhook')?.events?.includes(event);
                              return (
                                <button
                                  key={event}
                                  onClick={() => toggleEvent('webhook', event)}
                                  className={`flex items-center gap-2 px-3 py-2 rounded border text-sm ${
                                    isEnabled
                                      ? 'bg-orange-50 border-orange-300 text-orange-700'
                                      : 'bg-gray-50 border-gray-200 text-gray-600'
                                  }`}
                                >
                                  {isEnabled ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                                  {eventLabels[event]}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Test Notification */}
                  <div className="border rounded-lg p-4 bg-gray-50">
                    <h3 className="font-medium text-gray-900 mb-4 flex items-center gap-2">
                      <Send className="w-4 h-4" />
                      Test Bildirimi Gönder
                    </h3>
                    <div className="flex gap-4 items-end">
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Kanal</label>
                        <select
                          value={testChannel}
                          onChange={(e) => setTestChannel(e.target.value as NotificationChannel)}
                          className="w-full border border-gray-300 rounded px-3 py-2"
                        >
                          <option value="whatsapp">WhatsApp</option>
                          <option value="webhook">Webhook</option>
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {testChannel === 'whatsapp' ? 'Telefon' : 'URL'}
                        </label>
                        <input
                          type="text"
                          value={testRecipient}
                          onChange={(e) => setTestRecipient(e.target.value)}
                          placeholder={testChannel === 'whatsapp' ? '+905xxxxxxxxx' : 'https://...'}
                          className="w-full border border-gray-300 rounded px-3 py-2"
                        />
                      </div>
                      <button
                        onClick={() => sendTestMutation.mutate()}
                        disabled={!testRecipient || sendTestMutation.isPending}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                      >
                        {sendTestMutation.isPending ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                        Gönder
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Templates Tab */}
          {activeTab === 'templates' && (
            <div>
              {loadingTemplates ? (
                <div className="text-center py-12">
                  <RefreshCw className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                </div>
              ) : (
                <div className="space-y-4">
                  {templates.map((template) => (
                    <div key={template.id} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          {(() => {
                            const config = channelConfig[template.channel];
                            const Icon = config.icon;
                            return <Icon className={`w-5 h-5 ${config.color}`} />;
                          })()}
                          <span className="font-medium">{template.name}</span>
                          <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                            {eventLabels[template.event]}
                          </span>
                          <span
                            className={`px-2 py-0.5 text-xs rounded ${
                              template.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {template.isActive ? 'Aktif' : 'Pasif'}
                          </span>
                        </div>
                        <button
                          onClick={() => setEditingTemplate(template)}
                          className="text-gray-500 hover:text-gray-700"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded font-mono">
                        {template.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Edit Template Modal */}
              {editingTemplate && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                  <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-6">
                    <h3 className="text-lg font-medium mb-4">Şablon Düzenle</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Ad</label>
                        <input
                          type="text"
                          value={editingTemplate.name}
                          onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                          className="w-full border border-gray-300 rounded px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">İçerik</label>
                        <textarea
                          value={editingTemplate.content}
                          onChange={(e) => setEditingTemplate({ ...editingTemplate, content: e.target.value })}
                          rows={4}
                          className="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Kullanılabilir değişkenler: {'{{hotel_name}}'}, {'{{item_count}}'}, {'{{barcode}}'}, {'{{package_count}}'}, {'{{driver_name}}'}, {'{{bag_code}}'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="template-active"
                          checked={editingTemplate.isActive}
                          onChange={(e) =>
                            setEditingTemplate({ ...editingTemplate, isActive: e.target.checked })
                          }
                          className="rounded"
                        />
                        <label htmlFor="template-active" className="text-sm text-gray-700">
                          Aktif
                        </label>
                      </div>
                    </div>
                    <div className="flex justify-end gap-3 mt-6">
                      <button
                        onClick={() => setEditingTemplate(null)}
                        className="px-4 py-2 text-gray-600 hover:text-gray-800"
                      >
                        İptal
                      </button>
                      <button
                        onClick={() => {
                          updateTemplateMutation.mutate({
                            id: editingTemplate.id,
                            template: {
                              name: editingTemplate.name,
                              content: editingTemplate.content,
                              isActive: editingTemplate.isActive,
                            },
                          });
                        }}
                        disabled={updateTemplateMutation.isPending}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                      >
                        {updateTemplateMutation.isPending ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                        Kaydet
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Logs Tab */}
          {activeTab === 'logs' && (
            <div>
              {loadingLogs ? (
                <div className="text-center py-12">
                  <RefreshCw className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tarih</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Kanal</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Olay</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Alıcı</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Durum</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {logsData?.logs.map((log) => (
                        <tr key={log.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {format(new Date(log.createdAt), 'dd MMM yyyy HH:mm', { locale: tr })}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <div className="flex items-center gap-2">
                              {(() => {
                                const config = channelConfig[log.channel];
                                const Icon = config.icon;
                                return (
                                  <>
                                    <Icon className={`w-4 h-4 ${config.color}`} />
                                    <span>{config.label}</span>
                                  </>
                                );
                              })()}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{eventLabels[log.event]}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">{log.recipient}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 text-xs rounded ${statusColors[log.status]}`}>
                              {log.status}
                            </span>
                            {log.errorMessage && (
                              <span className="block text-xs text-red-500 mt-1">{log.errorMessage}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {logsData?.logs.length === 0 && (
                    <div className="text-center py-12 text-gray-500">Henüz bildirim gönderilmemiş</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
