import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tag, Plus, Search, RefreshCw, X, Edit2, Trash2, Building2, ChevronDown, ChevronRight, Package, Download, Filter } from 'lucide-react';
import { itemsApi, settingsApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import type { Item, Tenant, ItemType } from '../types';

// Storage key for selected hotel
const SELECTED_HOTEL_KEY = 'items_selected_hotel';

interface ItemFormData {
  rfidTag: string;
  itemTypeId: string;
  tenantId: string;
  status: string;
  location: string;
  notes: string;
}

const statusOptions = [
  { value: 'at_hotel', label: 'Otelde', color: 'bg-blue-100 text-blue-800' },
  { value: 'at_laundry', label: 'Çamaşırhanede', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'processing', label: 'İşleniyor', color: 'bg-orange-100 text-orange-800' },
  { value: 'ready_for_delivery', label: 'Teslimata Hazır', color: 'bg-green-100 text-green-800' },
  { value: 'label_printed', label: 'Etiket Basıldı', color: 'bg-purple-100 text-purple-800' },
  { value: 'packaged', label: 'Paketlendi', color: 'bg-indigo-100 text-indigo-800' },
  { value: 'in_transit', label: 'Yolda', color: 'bg-cyan-100 text-cyan-800' },
  { value: 'delivered', label: 'Teslim Edildi', color: 'bg-gray-100 text-gray-800' },
];

export function ItemManagementPage() {
  const [selectedHotelId, setSelectedHotelId] = useState<string | null>(null);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [hotelSearchTerm, setHotelSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);

  // Dropdown search states
  const [itemTypeSearch, setItemTypeSearch] = useState('');
  const [itemTypeDropdownOpen, setItemTypeDropdownOpen] = useState(false);
  const [hotelDropdownSearch, setHotelDropdownSearch] = useState('');
  const [hotelDropdownOpen, setHotelDropdownOpen] = useState(false);

  // Refs for keyboard control
  const itemTypeInputRef = useRef<HTMLInputElement>(null);
  const hotelInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState<ItemFormData>({
    rfidTag: '',
    itemTypeId: '',
    tenantId: '',
    status: 'at_hotel',
    location: '',
    notes: '',
  });

  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();

  const canDeleteItems = user?.role === 'system_admin' || user?.role === 'admin' || user?.role === 'laundry_manager';

  // Load selected hotel from localStorage
  useEffect(() => {
    const savedHotel = localStorage.getItem(SELECTED_HOTEL_KEY);
    if (savedHotel) {
      setSelectedHotelId(savedHotel);
    }
  }, []);

  // Save selected hotel to localStorage
  const selectHotel = (hotelId: string | null) => {
    setSelectedHotelId(hotelId);
    setExpandedTypes(new Set());
    if (hotelId) {
      localStorage.setItem(SELECTED_HOTEL_KEY, hotelId);
    } else {
      localStorage.removeItem(SELECTED_HOTEL_KEY);
    }
  };

  // Fetch tenants
  const { data: tenants, isLoading: tenantsLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: settingsApi.getTenants,
  });

  // Fetch item types
  const { data: itemTypes } = useQuery({
    queryKey: ['item-types'],
    queryFn: settingsApi.getItemTypes,
  });

  // Fetch ALL items for selected hotel (paginated - backend max 100)
  const { data: itemsData, isLoading: itemsLoading, refetch } = useQuery({
    queryKey: ['items', selectedHotelId, statusFilter, searchTerm],
    queryFn: async () => {
      if (!selectedHotelId) return { data: [], total: 0 };

      const allItems: Item[] = [];
      let page = 1;
      const limit = 100; // Backend max is 100
      let totalPages = 1;

      // First request to get total pages
      const firstResult = await itemsApi.getAll({
        page: 1,
        limit,
        tenantId: selectedHotelId,
        status: statusFilter || undefined,
        search: searchTerm || undefined
      });

      if (firstResult.data) {
        allItems.push(...firstResult.data);
        totalPages = firstResult.pagination?.totalPages || 1;
      }

      // Fetch remaining pages
      for (page = 2; page <= totalPages && page <= 100; page++) {
        const result = await itemsApi.getAll({
          page,
          limit,
          tenantId: selectedHotelId,
          status: statusFilter || undefined,
          search: searchTerm || undefined
        });
        if (result.data && result.data.length > 0) {
          allItems.push(...result.data);
        }
      }

      return { data: allItems, total: allItems.length };
    },
    enabled: !!selectedHotelId,
  });

  // Fetch ALL items to count per hotel (paginated - backend max 100)
  const { data: allItemsData, isLoading: allItemsLoading } = useQuery({
    queryKey: ['all-items-summary'],
    queryFn: async () => {
      const allItems: Item[] = [];
      const limit = 100; // Backend max is 100
      let totalPages = 1;

      // First request to get total pages
      const firstResult = await itemsApi.getAll({ page: 1, limit });
      if (firstResult.data) {
        allItems.push(...firstResult.data);
        totalPages = firstResult.pagination?.totalPages || 1;
      }

      // Fetch remaining pages
      for (let page = 2; page <= totalPages && page <= 500; page++) {
        const result = await itemsApi.getAll({ page, limit });
        if (result.data && result.data.length > 0) {
          allItems.push(...result.data);
        }
      }

      return { data: allItems, total: allItems.length };
    },
    enabled: !selectedHotelId, // Only fetch when on hotel selection screen
    staleTime: 60000, // Cache for 1 minute
  });

  // Calculate hotel stats from all items
  const hotelStats = useMemo(() => {
    if (!allItemsData?.data) return {};
    const stats: Record<string, number> = {};
    for (const item of allItemsData.data) {
      stats[item.tenantId] = (stats[item.tenantId] || 0) + 1;
    }
    return stats;
  }, [allItemsData]);

  const createMutation = useMutation({
    mutationFn: itemsApi.create,
    onSuccess: () => {
      toast.success('Ürün başarıyla oluşturuldu!');
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['all-items-summary'] });
      closeModal();
    },
    onError: (err) => toast.error('Ürün oluşturulamadı', getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Item> }) => itemsApi.update(id, data),
    onSuccess: () => {
      toast.success('Ürün başarıyla güncellendi!');
      queryClient.invalidateQueries({ queryKey: ['items'] });
      closeModal();
    },
    onError: (err) => toast.error('Ürün güncellenemedi', getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: itemsApi.delete,
    onSuccess: () => {
      toast.success('Ürün başarıyla silindi!');
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['all-items-summary'] });
    },
    onError: (err) => toast.error('Ürün silinemedi', getErrorMessage(err)),
  });

  const closeModal = () => {
    setShowModal(false);
    setEditingItem(null);
    setItemTypeDropdownOpen(false);
    setHotelDropdownOpen(false);
    setItemTypeSearch('');
    setHotelDropdownSearch('');
    setFormData({
      rfidTag: '',
      itemTypeId: '',
      tenantId: selectedHotelId || '',
      status: 'at_hotel',
      location: '',
      notes: '',
    });
  };

  const openCreateModal = () => {
    setEditingItem(null);
    setFormData({
      rfidTag: '',
      itemTypeId: '',
      tenantId: selectedHotelId || '',
      status: 'at_hotel',
      location: '',
      notes: '',
    });
    setShowModal(true);
  };

  const openEditModal = (item: Item) => {
    setEditingItem(item);
    setFormData({
      rfidTag: item.rfidTag,
      itemTypeId: item.itemTypeId,
      tenantId: item.tenantId,
      status: item.status,
      location: item.location || '',
      notes: item.notes || '',
    });
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingItem) {
      updateMutation.mutate({
        id: editingItem.id,
        data: {
          status: formData.status as any,
          location: formData.location || undefined,
          notes: formData.notes || undefined,
        },
      });
    } else {
      createMutation.mutate({
        rfidTag: formData.rfidTag,
        itemTypeId: formData.itemTypeId,
        tenantId: formData.tenantId,
        status: formData.status as any,
        location: formData.location || undefined,
        notes: formData.notes || undefined,
      });
    }
  };

  const handleDelete = (item: Item) => {
    if (confirm(`${item.rfidTag} etiketli ürünü silmek istediğinizden emin misiniz?`)) {
      deleteMutation.mutate(item.id);
    }
  };

  const toggleTypeExpanded = (typeId: string) => {
    const newExpanded = new Set(expandedTypes);
    if (newExpanded.has(typeId)) {
      newExpanded.delete(typeId);
    } else {
      newExpanded.add(typeId);
    }
    setExpandedTypes(newExpanded);
  };

  const getStatusInfo = (status: string) => {
    return statusOptions.find(opt => opt.value === status) || { label: status, color: 'bg-gray-100 text-gray-800' };
  };

  const items = itemsData?.data || [];
  const selectedHotel = tenants?.find((t: Tenant) => t.id === selectedHotelId);

  // Group items by type
  const itemsByType = items.reduce((acc: Record<string, Item[]>, item: Item) => {
    const typeId = item.itemTypeId;
    if (!acc[typeId]) {
      acc[typeId] = [];
    }
    acc[typeId].push(item);
    return acc;
  }, {});

  // Calculate status summary
  const statusSummary = items.reduce((acc: Record<string, number>, item: Item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  // Export to CSV
  const exportToCSV = () => {
    if (!items.length) return;

    const headers = ['RFID Etiketi', 'Ürün Tipi', 'Durum', 'Konum', 'Yıkama Sayısı', 'Oluşturulma Tarihi'];
    const rows = items.map((item: Item) => [
      item.rfidTag,
      itemTypes?.find((t: ItemType) => t.id === item.itemTypeId)?.name || '',
      getStatusInfo(item.status).label,
      item.location || '',
      item.washCount,
      new Date(item.createdAt).toLocaleDateString('tr-TR')
    ]);

    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedHotel?.name || 'urunler'}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  // Filter hotels by search term
  const filteredTenants = useMemo(() => {
    if (!tenants) return [];
    if (!hotelSearchTerm) return tenants;
    const searchLower = hotelSearchTerm.toLowerCase();
    return tenants.filter((t: Tenant) => t.name.toLowerCase().includes(searchLower));
  }, [tenants, hotelSearchTerm]);

  // Filter item types for dropdown
  const filteredItemTypes = useMemo(() => {
    if (!itemTypes) return [];
    if (!itemTypeSearch) return itemTypes;
    const searchLower = itemTypeSearch.toLowerCase();
    return itemTypes.filter((t: ItemType) => t.name.toLowerCase().includes(searchLower));
  }, [itemTypes, itemTypeSearch]);

  // Filter hotels for dropdown
  const filteredDropdownHotels = useMemo(() => {
    if (!tenants) return [];
    if (!hotelDropdownSearch) return tenants;
    const searchLower = hotelDropdownSearch.toLowerCase();
    return tenants.filter((t: Tenant) => t.name.toLowerCase().includes(searchLower));
  }, [tenants, hotelDropdownSearch]);

  // Total items count
  const totalItemsCount = allItemsData?.total || allItemsData?.data?.length || 0;

  // Hotel Selection View
  if (!selectedHotelId) {
    return (
      <div className="p-8 animate-fade-in">
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex p-4 bg-teal-100 rounded-full mb-4">
              <Tag className="w-12 h-12 text-teal-600" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Ürün Yönetimi</h1>
            <p className="text-gray-500">
              {totalItemsCount > 0
                ? `Toplam ${totalItemsCount.toLocaleString('tr-TR')} ürün • Görüntülemek istediğiniz oteli seçin`
                : 'Görüntülemek istediğiniz oteli seçin'
              }
            </p>
          </div>

          {/* Search Bar */}
          <div className="mb-6">
            <div className="relative max-w-md mx-auto">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={hotelSearchTerm}
                onChange={(e) => setHotelSearchTerm(e.target.value)}
                placeholder="Otel ara..."
                className="w-full pl-12 pr-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-lg"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              {hotelSearchTerm && (
                <button
                  onClick={() => setHotelSearchTerm('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>

          {/* Hotel Grid */}
          {tenantsLoading || allItemsLoading ? (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <RefreshCw className="w-10 h-10 animate-spin text-teal-500" />
              <p className="text-gray-500">Ürünler yükleniyor...</p>
            </div>
          ) : filteredTenants.length === 0 ? (
            <div className="text-center py-16">
              <Building2 className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <p className="text-xl text-gray-500">
                {hotelSearchTerm ? `"${hotelSearchTerm}" için sonuç bulunamadı` : 'Henüz otel eklenmemiş'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTenants.map((tenant: Tenant) => {
                const itemCount = hotelStats[tenant.id] || 0;
                return (
                  <button
                    key={tenant.id}
                    onClick={() => selectHotel(tenant.id)}
                    className="bg-white rounded-xl border-2 border-gray-200 p-6 hover:border-teal-500 hover:shadow-lg transition-all text-left group"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="p-3 bg-teal-50 rounded-lg group-hover:bg-teal-100 transition-colors">
                        <Building2 className="w-6 h-6 text-teal-600" />
                      </div>
                      <span className={`text-3xl font-bold ${itemCount > 0 ? 'text-teal-600' : 'text-gray-300'}`}>
                        {itemCount.toLocaleString('tr-TR')}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 mb-1">{tenant.name}</h3>
                    <p className="text-sm text-gray-500">
                      {itemCount > 0 ? `${itemCount.toLocaleString('tr-TR')} ürün kayıtlı` : 'Henüz ürün yok'}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Hotel Detail View
  return (
    <div className="p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => selectHotel(null)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Geri"
          >
            <ChevronRight className="w-6 h-6 text-gray-600 rotate-180" />
          </button>
          <div className="p-3 bg-teal-100 rounded-lg">
            <Building2 className="w-8 h-8 text-teal-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{selectedHotel?.name}</h1>
            <p className="text-gray-500">
              {items.length} ürün • Son güncelleme: {new Date().toLocaleTimeString('tr-TR')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            <RefreshCw className={`w-5 h-5 ${itemsLoading ? 'animate-spin' : ''}`} />
            Yenile
          </button>
          <button
            onClick={exportToCSV}
            disabled={items.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
          >
            <Download className="w-5 h-5" />
            CSV
          </button>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
          >
            <Plus className="w-5 h-5" />
            Ürün Ekle
          </button>
        </div>
      </div>

      {/* Status Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {statusOptions.map(status => {
          const count = statusSummary[status.value] || 0;
          const isActive = statusFilter === status.value;
          return (
            <button
              key={status.value}
              onClick={() => setStatusFilter(isActive ? '' : status.value)}
              className={`p-3 rounded-lg border-2 transition-all ${
                isActive
                  ? 'border-teal-500 bg-teal-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="text-2xl font-bold text-gray-900">{count}</div>
              <div className="text-xs text-gray-500 truncate">{status.label}</div>
            </button>
          );
        })}
      </div>

      {/* Search & Filter */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[250px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="RFID etiketi ara..."
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
          {statusFilter && (
            <button
              onClick={() => setStatusFilter('')}
              className="flex items-center gap-2 px-4 py-2 bg-teal-100 text-teal-700 rounded-lg hover:bg-teal-200"
            >
              <Filter className="w-4 h-4" />
              {getStatusInfo(statusFilter).label}
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Items by Type */}
      <div className="space-y-4">
        {itemsLoading ? (
          <div className="flex items-center justify-center h-64 bg-white rounded-lg shadow">
            <RefreshCw className="w-10 h-10 animate-spin text-teal-500" />
          </div>
        ) : items.length === 0 ? (
          <div className="p-16 text-center bg-white rounded-lg shadow">
            <Package className="w-20 h-20 mx-auto text-gray-300 mb-4" />
            <p className="text-2xl font-semibold text-gray-500">
              {statusFilter || searchTerm ? 'Filtreye uygun ürün bulunamadı' : 'Henüz ürün yok'}
            </p>
            <p className="text-gray-400 mt-2">
              {statusFilter || searchTerm ? 'Filtreleri temizleyerek tekrar deneyin' : 'Yeni ürün ekleyerek başlayın'}
            </p>
          </div>
        ) : (
          <>
            {/* Summary Table */}
            <div className="bg-white rounded-xl shadow-lg overflow-hidden">
              <div className="bg-gray-50 px-6 py-4 border-b">
                <h2 className="text-lg font-bold text-gray-900">Ürün Türlerine Göre Dağılım</h2>
              </div>
              <div className="divide-y">
                {Object.entries(itemsByType)
                  .sort(([, a], [, b]) => b.length - a.length)
                  .map(([typeId, typeItems]) => {
                    const itemType = itemTypes?.find((t: ItemType) => t.id === typeId);
                    const isExpanded = expandedTypes.has(typeId);

                    return (
                      <div key={typeId}>
                        {/* Type Header */}
                        <button
                          onClick={() => toggleTypeExpanded(typeId)}
                          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center gap-4">
                            {isExpanded ? (
                              <ChevronDown className="w-5 h-5 text-gray-400" />
                            ) : (
                              <ChevronRight className="w-5 h-5 text-gray-400" />
                            )}
                            <Tag className="w-5 h-5 text-teal-600" />
                            <span className="font-semibold text-gray-900">
                              {itemType?.name || 'Bilinmeyen Tip'}
                            </span>
                          </div>
                          <div className="flex items-center gap-4">
                            {/* Mini status breakdown */}
                            <div className="hidden md:flex items-center gap-2">
                              {Object.entries(
                                typeItems.reduce((acc: Record<string, number>, item) => {
                                  acc[item.status] = (acc[item.status] || 0) + 1;
                                  return acc;
                                }, {})
                              ).slice(0, 3).map(([status, count]) => (
                                <span
                                  key={status}
                                  className={`px-2 py-0.5 text-xs rounded-full ${getStatusInfo(status).color}`}
                                >
                                  {count}
                                </span>
                              ))}
                            </div>
                            <span className="text-2xl font-bold text-teal-600 min-w-[60px] text-right">
                              {typeItems.length}
                            </span>
                          </div>
                        </button>

                        {/* Expanded Items */}
                        {isExpanded && (
                          <div className="bg-gray-50 border-t">
                            <div className="overflow-x-auto">
                              <table className="w-full">
                                <thead>
                                  <tr className="text-left text-xs text-gray-500 uppercase bg-gray-100">
                                    <th className="px-6 py-3 font-semibold">RFID Etiketi</th>
                                    <th className="px-6 py-3 font-semibold">Durum</th>
                                    <th className="px-6 py-3 font-semibold">Konum</th>
                                    <th className="px-6 py-3 font-semibold text-center">Yıkama</th>
                                    <th className="px-6 py-3 font-semibold text-right">İşlem</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 bg-white">
                                  {typeItems.map((item) => (
                                    <tr key={item.id} className="hover:bg-gray-50">
                                      <td className="px-6 py-3">
                                        <span className="font-mono text-sm font-semibold text-gray-900">
                                          {item.rfidTag}
                                        </span>
                                      </td>
                                      <td className="px-6 py-3">
                                        <span className={`px-2 py-1 text-xs rounded-full ${getStatusInfo(item.status).color}`}>
                                          {getStatusInfo(item.status).label}
                                        </span>
                                      </td>
                                      <td className="px-6 py-3 text-sm text-gray-600">
                                        {item.location || '-'}
                                      </td>
                                      <td className="px-6 py-3 text-center">
                                        <span className="font-semibold text-gray-900">{item.washCount}</span>
                                      </td>
                                      <td className="px-6 py-3 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                          <button
                                            onClick={() => openEditModal(item)}
                                            className="p-2 text-gray-600 hover:bg-gray-200 rounded-lg"
                                            title="Düzenle"
                                          >
                                            <Edit2 className="w-4 h-4" />
                                          </button>
                                          {canDeleteItems && (
                                            <button
                                              onClick={() => handleDelete(item)}
                                              className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                                              title="Sil"
                                            >
                                              <Trash2 className="w-4 h-4" />
                                            </button>
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
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Total */}
            <div className="text-center text-gray-500">
              Toplam <span className="font-bold text-gray-900">{items.length}</span> ürün gösteriliyor
            </div>
          </>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="p-6 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold">{editingItem ? 'Ürün Düzenle' : 'Yeni Ürün Ekle'}</h2>
              <button onClick={closeModal} className="text-gray-500 hover:text-gray-700">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {!editingItem && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      RFID Etiketi <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.rfidTag}
                      onChange={(e) => setFormData({ ...formData, rfidTag: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                      placeholder="E200..."
                      required
                    />
                  </div>

                  <div className="relative">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Ürün Tipi <span className="text-red-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const opening = !itemTypeDropdownOpen;
                        setItemTypeDropdownOpen(opening);
                        if (opening) {
                          setTimeout(() => itemTypeInputRef.current?.focus(), 100);
                        }
                      }}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 text-left bg-white flex items-center justify-between"
                    >
                      <span className={formData.itemTypeId ? 'text-gray-900' : 'text-gray-400'}>
                        {formData.itemTypeId
                          ? itemTypes?.find((t: ItemType) => t.id === formData.itemTypeId)?.name
                          : 'Ürün tipi seçin...'}
                      </span>
                      <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${itemTypeDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {itemTypeDropdownOpen && (
                      <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-hidden">
                        <div className="p-2 border-b sticky top-0 bg-white">
                          <input
                            ref={itemTypeInputRef}
                            type="text"
                            value={itemTypeSearch}
                            onChange={(e) => setItemTypeSearch(e.target.value)}
                            placeholder="Ürün tipi ara..."
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 text-sm"
                            inputMode="search"
                            enterKeyHint="search"
                            autoComplete="off"
                          />
                        </div>
                        <div className="max-h-48 overflow-y-auto">
                          {filteredItemTypes.length === 0 ? (
                            <div className="px-3 py-2 text-gray-500 text-sm">Sonuç bulunamadı</div>
                          ) : (
                            filteredItemTypes.map((type: ItemType) => (
                              <button
                                key={type.id}
                                type="button"
                                onClick={() => {
                                  itemTypeInputRef.current?.blur();
                                  setFormData({ ...formData, itemTypeId: type.id });
                                  setItemTypeDropdownOpen(false);
                                  setItemTypeSearch('');
                                }}
                                className={`w-full px-3 py-2 text-left hover:bg-teal-50 text-sm ${
                                  formData.itemTypeId === type.id ? 'bg-teal-100 text-teal-700' : ''
                                }`}
                              >
                                {type.name}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Otel <span className="text-red-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const opening = !hotelDropdownOpen;
                        setHotelDropdownOpen(opening);
                        if (opening) {
                          setTimeout(() => hotelInputRef.current?.focus(), 100);
                        }
                      }}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 text-left bg-white flex items-center justify-between"
                    >
                      <span className={formData.tenantId ? 'text-gray-900' : 'text-gray-400'}>
                        {formData.tenantId
                          ? tenants?.find((t: Tenant) => t.id === formData.tenantId)?.name
                          : 'Otel seçin...'}
                      </span>
                      <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${hotelDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {hotelDropdownOpen && (
                      <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-hidden">
                        <div className="p-2 border-b sticky top-0 bg-white">
                          <input
                            ref={hotelInputRef}
                            type="text"
                            value={hotelDropdownSearch}
                            onChange={(e) => setHotelDropdownSearch(e.target.value)}
                            placeholder="Otel ara..."
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 text-sm"
                            inputMode="search"
                            enterKeyHint="search"
                            autoComplete="off"
                          />
                        </div>
                        <div className="max-h-48 overflow-y-auto">
                          {filteredDropdownHotels.length === 0 ? (
                            <div className="px-3 py-2 text-gray-500 text-sm">Sonuç bulunamadı</div>
                          ) : (
                            filteredDropdownHotels.map((tenant: Tenant) => (
                              <button
                                key={tenant.id}
                                type="button"
                                onClick={() => {
                                  hotelInputRef.current?.blur();
                                  setFormData({ ...formData, tenantId: tenant.id });
                                  setHotelDropdownOpen(false);
                                  setHotelDropdownSearch('');
                                }}
                                className={`w-full px-3 py-2 text-left hover:bg-teal-50 text-sm ${
                                  formData.tenantId === tenant.id ? 'bg-teal-100 text-teal-700' : ''
                                }`}
                              >
                                {tenant.name}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Durum</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                >
                  {statusOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Konum</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                  placeholder="Oda 101, Çamaşırhane, vb."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notlar</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                  placeholder="Ek notlar..."
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? 'Kaydediliyor...'
                    : editingItem
                    ? 'Güncelle'
                    : 'Oluştur'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
