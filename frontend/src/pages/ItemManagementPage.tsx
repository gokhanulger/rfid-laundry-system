import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tag, Plus, Search, RefreshCw, X, Edit2, Trash2, Building2 } from 'lucide-react';
import { itemsApi, settingsApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import type { Item, Tenant } from '../types';

// Storage key for selected hotels
const SELECTED_HOTELS_KEY = 'items_selected_hotels';

interface ItemFormData {
  rfidTag: string;
  itemTypeId: string;
  tenantId: string;
  status: string;
  location: string;
  notes: string;
}

const statusOptions = [
  { value: 'at_hotel', label: 'At Hotel' },
  { value: 'at_laundry', label: 'At Laundry' },
  { value: 'processing', label: 'Processing' },
  { value: 'ready_for_delivery', label: 'Ready for Delivery' },
  { value: 'label_printed', label: 'Label Printed' },
  { value: 'packaged', label: 'Packaged' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'delivered', label: 'Delivered' },
];

export function ItemManagementPage() {
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [formData, setFormData] = useState<ItemFormData>({
    rfidTag: '',
    itemTypeId: '',
    tenantId: '',
    status: 'at_hotel',
    location: '',
    notes: '',
  });

  // Hotel selection state
  const [selectedHotelIds, setSelectedHotelIds] = useState<string[]>([]);
  const [showHotelSelector, setShowHotelSelector] = useState(false);

  const queryClient = useQueryClient();
  const toast = useToast();

  // Load selected hotels from localStorage on mount
  useEffect(() => {
    const savedHotels = localStorage.getItem(SELECTED_HOTELS_KEY);
    if (savedHotels) {
      try {
        const hotels = JSON.parse(savedHotels);
        if (hotels.length > 0) {
          setSelectedHotelIds(hotels);
        }
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  // Save selected hotels to localStorage
  const saveSelectedHotels = (hotelIds: string[]) => {
    setSelectedHotelIds(hotelIds);
    localStorage.setItem(SELECTED_HOTELS_KEY, JSON.stringify(hotelIds));
  };

  const toggleHotelSelection = (hotelId: string) => {
    const newSelection = selectedHotelIds.includes(hotelId)
      ? selectedHotelIds.filter(id => id !== hotelId)
      : [...selectedHotelIds, hotelId];
    saveSelectedHotels(newSelection);
  };

  const { data: itemsData, isLoading } = useQuery({
    queryKey: ['items', { page, status: statusFilter, search: searchTerm }],
    queryFn: () => itemsApi.getAll({ page, limit: 100, status: statusFilter || undefined, search: searchTerm || undefined }),
  });

  const { data: itemTypes } = useQuery({
    queryKey: ['item-types'],
    queryFn: settingsApi.getItemTypes,
  });

  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: settingsApi.getTenants,
  });

  const selectAllHotels = () => {
    if (tenants) {
      saveSelectedHotels(tenants.map((t: Tenant) => t.id));
    }
  };

  const clearHotelSelection = () => {
    saveSelectedHotels([]);
  };

  const createMutation = useMutation({
    mutationFn: itemsApi.create,
    onSuccess: () => {
      toast.success('Item created successfully!');
      queryClient.invalidateQueries({ queryKey: ['items'] });
      closeModal();
    },
    onError: (err) => toast.error('Failed to create item', getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Item> }) => itemsApi.update(id, data),
    onSuccess: () => {
      toast.success('Item updated successfully!');
      queryClient.invalidateQueries({ queryKey: ['items'] });
      closeModal();
    },
    onError: (err) => toast.error('Failed to update item', getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: itemsApi.delete,
    onSuccess: () => {
      toast.success('Item deleted successfully!');
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
    onError: (err) => toast.error('Failed to delete item', getErrorMessage(err)),
  });

  const closeModal = () => {
    setShowModal(false);
    setEditingItem(null);
    setFormData({
      rfidTag: '',
      itemTypeId: '',
      tenantId: '',
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
      tenantId: '',
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
    if (confirm(`Are you sure you want to delete item ${item.rfidTag}?`)) {
      deleteMutation.mutate(item.id);
    }
  };

  const generateRfidTag = () => {
    const randomNum = Math.floor(Math.random() * 1000000);
    setFormData({ ...formData, rfidTag: `RFID-${String(randomNum).padStart(6, '0')}` });
  };

  const toggleSection = (sectionKey: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionKey]: !prev[sectionKey]
    }));
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      at_hotel: 'bg-blue-100 text-blue-800',
      at_laundry: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-orange-100 text-orange-800',
      ready_for_delivery: 'bg-green-100 text-green-800',
      label_printed: 'bg-purple-100 text-purple-800',
      packaged: 'bg-indigo-100 text-indigo-800',
      in_transit: 'bg-cyan-100 text-cyan-800',
      delivered: 'bg-gray-100 text-gray-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const items = itemsData?.data || [];
  const pagination = itemsData?.pagination;

  // Filter items by selected hotels
  const filteredItems = selectedHotelIds.length > 0
    ? items.filter(item => selectedHotelIds.includes(item.tenantId))
    : items;

  // Group items by hotel, then by type
  const itemsByHotel = filteredItems.reduce((acc: Record<string, Record<string, Item[]>>, item) => {
    const hotelId = item.tenantId;
    const typeId = item.itemTypeId;

    if (!acc[hotelId]) {
      acc[hotelId] = {};
    }
    if (!acc[hotelId][typeId]) {
      acc[hotelId][typeId] = [];
    }
    acc[hotelId][typeId].push(item);
    return acc;
  }, {});

  // Hotel Selection Dialog
  const HotelSelectionDialog = () => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Building2 className="w-6 h-6 text-teal-600" />
            Select Hotels
          </h2>
          <button
            onClick={() => setShowHotelSelector(false)}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable hotel list */}
        <div className="max-h-[350px] overflow-y-auto border rounded-lg divide-y mb-4">
          {tenants?.map((tenant: Tenant) => {
            const isSelected = selectedHotelIds.includes(tenant.id);
            const hotelItemCount = items.filter((i: Item) => i.tenantId === tenant.id).length;
            return (
              <label
                key={tenant.id}
                className={`flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                  isSelected ? 'bg-teal-50' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleHotelSelection(tenant.id)}
                    className="w-5 h-5 text-teal-600 rounded border-gray-300 focus:ring-teal-500"
                  />
                  <span className={`font-medium ${isSelected ? 'text-teal-900' : 'text-gray-900'}`}>
                    {tenant.name}
                  </span>
                </div>
                {hotelItemCount > 0 ? (
                  <span className="px-2 py-1 rounded-full text-sm font-bold bg-teal-100 text-teal-700">
                    {hotelItemCount}
                  </span>
                ) : (
                  <span className="text-sm text-gray-400">0</span>
                )}
              </label>
            );
          })}
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={selectAllHotels}
              className="text-sm text-teal-600 hover:text-teal-700 font-medium"
            >
              Select All
            </button>
            <span className="text-gray-300">|</span>
            <button
              onClick={clearHotelSelection}
              className="text-sm text-gray-600 hover:text-gray-700 font-medium"
            >
              Clear
            </button>
          </div>
          <span className="text-sm text-gray-600">
            {selectedHotelIds.length} selected
          </span>
        </div>

        <button
          onClick={() => setShowHotelSelector(false)}
          className="w-full px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-bold shadow-lg"
        >
          Apply Selection
        </button>
      </div>
    </div>
  );

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-teal-100 rounded-lg">
            <Tag className="w-8 h-8 text-teal-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Item Yonetimi</h1>
            <p className="text-gray-500">Manage RFID-tagged laundry items</p>
          </div>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
        >
          <Plus className="w-5 h-5" />
          Add Item
        </button>
      </div>

      {/* Selected Hotels Bar */}
      <div className="bg-teal-50 rounded-lg p-4 flex items-center gap-3 flex-wrap">
        <span className="text-teal-700 font-medium">Showing:</span>
        {selectedHotelIds.length === 0 ? (
          <span className="text-gray-500">All Hotels</span>
        ) : (
          selectedHotelIds.map(hotelId => {
            const hotel = tenants?.find((t: Tenant) => t.id === hotelId);
            const hotelItemCount = filteredItems.filter((i: Item) => i.tenantId === hotelId).length;
            return (
              <div
                key={hotelId}
                className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-full border border-teal-200"
              >
                <Building2 className="w-4 h-4 text-teal-600" />
                <span className="font-medium text-gray-900">{hotel?.name}</span>
                {hotelItemCount > 0 && (
                  <span className="px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full text-xs font-bold">
                    {hotelItemCount}
                  </span>
                )}
                <button
                  onClick={() => toggleHotelSelection(hotelId)}
                  className="text-gray-400 hover:text-red-500"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })
        )}
        <button
          onClick={() => setShowHotelSelector(true)}
          className="flex items-center gap-1 text-teal-600 hover:text-teal-700 text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          {selectedHotelIds.length === 0 ? 'Select Hotels' : 'Change'}
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                placeholder="Search by RFID tag..."
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
          >
            <option value="">All Statuses</option>
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Hotel Selection Dialog */}
      {showHotelSelector && <HotelSelectionDialog />}

      {/* Items Grouped by Hotel → Type → Count */}
      <div className="space-y-8">
        {isLoading ? (
          <div className="flex items-center justify-center h-64 bg-white rounded-lg shadow">
            <RefreshCw className="w-10 h-10 animate-spin text-teal-500" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-16 text-center bg-white rounded-lg shadow">
            <Tag className="w-20 h-20 mx-auto text-gray-300 mb-4" />
            <p className="text-2xl font-semibold text-gray-500">No items found</p>
            <p className="text-lg text-gray-400 mt-2">
              {selectedHotelIds.length > 0
                ? 'No items for selected hotels. Try selecting different hotels.'
                : 'Create items to start tracking laundry'}
            </p>
          </div>
        ) : (
          <>
            {Object.entries(itemsByHotel).map(([hotelId, itemsByType]) => {
              const hotel = tenants?.find((t) => t.id === hotelId);
              const totalItemsForHotel = Object.values(itemsByType).flat().length;
              const hotelSectionKey = `hotel-${hotelId}`;
              const hotelExpanded = expandedSections[hotelSectionKey] || false;

              return (
                <div key={hotelId} className="bg-white rounded-xl shadow-lg overflow-hidden border-2 border-teal-100">
                  {/* Hotel Header - Clickable */}
                  <button
                    onClick={() => toggleSection(hotelSectionKey)}
                    className="w-full bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 px-8 py-6 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <span className={`text-white text-2xl transform transition-transform ${hotelExpanded ? 'rotate-90' : ''}`}>
                          ▶
                        </span>
                        <h2 className="text-3xl font-bold text-white">
                          {hotel?.name || 'Unknown Hotel'}
                        </h2>
                      </div>
                      <span className="px-5 py-2 bg-white bg-opacity-25 text-white rounded-full text-lg font-bold">
                        {totalItemsForHotel} Total Items
                      </span>
                    </div>
                  </button>

                  {/* Item Types - Conditionally Rendered */}
                  {hotelExpanded && (
                    <div className="p-6 space-y-4">
                    {Object.entries(itemsByType).map(([typeId, typeItems]) => {
                      const itemType = itemTypes?.find((t) => t.id === typeId);
                      const sectionKey = `${hotelId}-${typeId}`;
                      const expanded = expandedSections[sectionKey] || false;

                      return (
                        <div key={typeId} className="border-2 border-gray-200 rounded-lg overflow-hidden hover:border-teal-300 transition-colors">
                          {/* Type Header - Clickable */}
                          <button
                            onClick={() => toggleSection(sectionKey)}
                            className="w-full bg-gray-50 hover:bg-gray-100 px-6 py-5 flex items-center justify-between transition-colors"
                          >
                            <div className="flex items-center gap-4">
                              <Tag className="w-7 h-7 text-teal-600" />
                              <div className="text-left">
                                <h3 className="text-2xl font-bold text-gray-900">
                                  {itemType?.name || 'Unknown Type'}
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">Click to view RFID tags</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-6">
                              <span className="text-4xl font-bold text-teal-600">
                                {typeItems.length}
                              </span>
                              <span className={`transform transition-transform ${expanded ? 'rotate-180' : ''}`}>
                                ▼
                              </span>
                            </div>
                          </button>

                          {/* Expanded Details - RFID Tags */}
                          {expanded && (
                            <div className="border-t-2 border-gray-200 bg-white">
                              <div className="px-6 py-4 bg-gray-100 border-b">
                                <p className="text-sm font-semibold text-gray-600 uppercase">RFID Tag Details</p>
                              </div>
                              <div className="divide-y divide-gray-100">
                                {typeItems.map((item) => (
                                  <div key={item.id} className="px-6 py-4 hover:bg-gray-50 flex items-center justify-between">
                                    <div className="flex-1 grid grid-cols-4 gap-4">
                                      <div>
                                        <p className="text-xs text-gray-500 mb-1">RFID Tag</p>
                                        <p className="font-mono font-semibold text-gray-900">{item.rfidTag}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-gray-500 mb-1">Status</p>
                                        <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(item.status)}`}>
                                          {item.status.replace('_', ' ')}
                                        </span>
                                      </div>
                                      <div>
                                        <p className="text-xs text-gray-500 mb-1">Location</p>
                                        <p className="text-sm text-gray-700">{item.location || '-'}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-gray-500 mb-1">Wash Count</p>
                                        <p className="text-sm font-medium text-gray-900">{item.washCount}x</p>
                                      </div>
                                    </div>
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => openEditModal(item)}
                                        className="p-3 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                                        title="Edit"
                                      >
                                        <Edit2 className="w-5 h-5" />
                                      </button>
                                      <button
                                        onClick={() => handleDelete(item)}
                                        className="p-3 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        title="Delete"
                                      >
                                        <Trash2 className="w-5 h-5" />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <div className="bg-white rounded-lg shadow px-6 py-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500">
                    Showing {(page - 1) * pagination.limit + 1} to {Math.min(page * pagination.limit, pagination.total)} of {pagination.total} items
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage(page - 1)}
                      disabled={page === 1}
                      className="px-3 py-1 border rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setPage(page + 1)}
                      disabled={page === pagination.totalPages}
                      className="px-3 py-1 border rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="p-6 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold">{editingItem ? 'Edit Item' : 'Add New Item'}</h2>
              <button onClick={closeModal} className="text-gray-500 hover:text-gray-700">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {!editingItem && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      RFID Tag <span className="text-red-500">*</span>
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={formData.rfidTag}
                        onChange={(e) => setFormData({ ...formData, rfidTag: e.target.value })}
                        className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                        placeholder="RFID-000001"
                        required
                      />
                      <button
                        type="button"
                        onClick={generateRfidTag}
                        className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                      >
                        Generate
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Item Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.itemTypeId}
                      onChange={(e) => setFormData({ ...formData, itemTypeId: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                      required
                    >
                      <option value="">Select item type...</option>
                      {itemTypes?.map((type) => (
                        <option key={type.id} value={type.id}>{type.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Hotel <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.tenantId}
                      onChange={(e) => setFormData({ ...formData, tenantId: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                      required
                    >
                      <option value="">Select hotel...</option>
                      {tenants?.map((tenant) => (
                        <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                  placeholder="Room 101, Laundry Facility, etc."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                  placeholder="Any additional notes..."
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? 'Saving...'
                    : editingItem
                    ? 'Update Item'
                    : 'Create Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
