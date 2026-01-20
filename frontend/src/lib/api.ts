import axios, { AxiosError } from 'axios';
import type {
  User,
  Item,
  Pickup,
  Delivery,
  Alert,
  Tenant,
  ItemType,
  DashboardStats,
  WorkflowStep,
  PaginatedResponse,
  CreatePickupForm,
  CreateDeliveryForm,
  CreateItemForm,
} from '../types';

// Check if running in Electron (multiple detection methods)
const isElectronApp = !!(
  (window as any).electronAPI ||
  (window as any).process?.type === 'renderer' ||
  navigator.userAgent.toLowerCase().includes('electron')
);

// Check if running on localhost with vite dev server
const isViteDevServer =
  window.location.hostname === 'localhost' &&
  window.location.port === '5173' &&
  window.location.protocol === 'http:';

// Always use Railway backend for:
// - Electron app (no proxy available)
// - Production builds (vercel, etc)
// Only use /api proxy for local vite dev server
const apiBaseUrl = isViteDevServer && !isElectronApp
  ? '/api'
  : 'https://rfid-laundry-backend-production.up.railway.app/api';

// Token storage key
const TOKEN_KEY = 'rfid_auth_token';

// Get stored token
export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

// Set token
export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

// Remove token
export function removeStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add Authorization header interceptor
api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Error handling helper
export function getErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    return error.response?.data?.error || error.message || 'An error occurred';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unexpected error occurred';
}

// Auth API
export const authApi = {
  login: async (email: string, password: string): Promise<User> => {
    const { data } = await api.post<User>('/auth/login', { email, password });
    return data;
  },

  logout: async (): Promise<void> => {
    await api.post('/auth/logout');
  },

  getMe: async (): Promise<User> => {
    const { data } = await api.get<User>('/auth/me');
    return data;
  },

  register: async (userData: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: string;
    tenantId?: string;
  }): Promise<User> => {
    const { data } = await api.post<User>('/auth/register', userData);
    return data;
  },
};

// Items API
export const itemsApi = {
  getAll: async (params?: {
    page?: number;
    limit?: number;
    status?: string;
    tenantId?: string;
    search?: string;
  }): Promise<PaginatedResponse<Item>> => {
    const { data } = await api.get<PaginatedResponse<Item>>('/items', { params });
    return data;
  },

  getById: async (id: string): Promise<Item> => {
    const { data } = await api.get<Item>(`/items/${id}`);
    return data;
  },

  getByRfid: async (rfidTag: string): Promise<Item> => {
    const { data } = await api.get<Item>(`/items/rfid/${rfidTag}`);
    return data;
  },

  getDirty: async (tenantId?: string): Promise<Item[]> => {
    const { data } = await api.get<Item[]>('/items/status/dirty', {
      params: { tenantId },
    });
    return data;
  },

  getReady: async (tenantId?: string): Promise<Item[]> => {
    const { data } = await api.get<Item[]>('/items/status/ready', {
      params: { tenantId },
    });
    return data;
  },

  create: async (item: CreateItemForm): Promise<Item> => {
    const { data } = await api.post<Item>('/items', item);
    return data;
  },

  update: async (id: string, updates: Partial<Item>): Promise<Item> => {
    const { data } = await api.patch<Item>(`/items/${id}`, updates);
    return data;
  },

  updateStatus: async (id: string, status: string): Promise<Item> => {
    const { data } = await api.patch<Item>(`/items/${id}/status`, { status });
    return data;
  },

  markClean: async (itemIds: string[]): Promise<{ items: Item[]; count: number }> => {
    const { data } = await api.post<{ items: Item[]; count: number }>('/items/mark-clean', { itemIds });
    return data;
  },

  scan: async (rfidTags: string[]): Promise<{
    items: Item[];
    found: number;
    notFound: number;
    notFoundTags: string[];
  }> => {
    const { data } = await api.post('/items/scan', { rfidTags });
    return data;
  },

  markDamaged: async (id: string, isDamaged: boolean, notes?: string): Promise<Item> => {
    const { data } = await api.patch<Item>(`/items/${id}/damaged`, { isDamaged, notes });
    return data;
  },

  markStained: async (id: string, isStained: boolean, notes?: string): Promise<Item> => {
    const { data } = await api.patch<Item>(`/items/${id}/stained`, { isStained, notes });
    return data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/items/${id}`);
  },
};

// Pickups API
export const pickupsApi = {
  getAll: async (params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<PaginatedResponse<Pickup>> => {
    const { data } = await api.get<PaginatedResponse<Pickup>>('/pickups', { params });
    return data;
  },

  getById: async (id: string): Promise<Pickup> => {
    const { data } = await api.get<Pickup>(`/pickups/${id}`);
    return data;
  },

  create: async (pickup: CreatePickupForm): Promise<Pickup> => {
    const { data } = await api.post<Pickup>('/pickups', pickup);
    return data;
  },

  receive: async (id: string): Promise<Pickup> => {
    const { data } = await api.post<Pickup>(`/pickups/${id}/receive`);
    return data;
  },
};

// Deliveries API
export const deliveriesApi = {
  getAll: async (params?: {
    page?: number;
    limit?: number;
    status?: string;
    driverId?: string;
  }): Promise<PaginatedResponse<Delivery>> => {
    const { data } = await api.get<PaginatedResponse<Delivery>>('/deliveries', { params });
    return data;
  },

  getById: async (id: string): Promise<Delivery> => {
    const { data } = await api.get<Delivery>(`/deliveries/${id}`);
    return data;
  },

  getByBarcode: async (barcode: string): Promise<Delivery> => {
    const { data } = await api.get<Delivery>(`/deliveries/barcode/${barcode}`);
    return data;
  },

  create: async (delivery: CreateDeliveryForm): Promise<Delivery> => {
    const { data } = await api.post<Delivery>('/deliveries', delivery);
    return data;
  },

  printLabel: async (id: string): Promise<Delivery> => {
    const { data } = await api.post<Delivery>(`/deliveries/${id}/print-label`);
    return data;
  },

  package: async (id: string): Promise<Delivery> => {
    const { data } = await api.post<Delivery>(`/deliveries/${id}/package`);
    return data;
  },

  pickup: async (id: string): Promise<Delivery> => {
    const { data } = await api.post<Delivery>(`/deliveries/${id}/pickup`);
    return data;
  },

  deliver: async (id: string, location?: { latitude: number; longitude: number; address?: string }): Promise<Delivery> => {
    const { data } = await api.post<Delivery>(`/deliveries/${id}/deliver`, location);
    return data;
  },

  scanPackage: async (barcode: string): Promise<{
    package: any;
    allPackagesScanned: boolean;
    totalPackages: number;
    scannedPackages: number;
  }> => {
    const { data } = await api.post(`/deliveries/packages/${barcode}/scan`);
    return data;
  },

  cancel: async (id: string): Promise<void> => {
    await api.post(`/deliveries/${id}/cancel`);
  },

  // Bag operations
  createBag: async (deliveryIds: string[]): Promise<{
    bagCode: string;
    deliveryCount: number;
    deliveries: Delivery[];
  }> => {
    const { data } = await api.post('/deliveries/create-bag', { deliveryIds });
    return data;
  },

  getBag: async (bagCode: string): Promise<{
    bagCode: string;
    deliveryCount: number;
    deliveries: Delivery[];
  }> => {
    const { data } = await api.get(`/deliveries/bag/${bagCode}`);
    return data;
  },

  deliverBag: async (bagCode: string): Promise<{
    bagCode: string;
    deliveredCount: number;
    totalCount: number;
    deliveredIds: string[];
    errors?: string[];
  }> => {
    const { data } = await api.post(`/deliveries/deliver-bag/${bagCode}`);
    return data;
  },
};

// Waybills API (Irsaliye)
export interface Waybill {
  id: string;
  tenantId: string;
  waybillNumber: string;
  status: 'created' | 'printed' | 'picked_up' | 'delivered';
  packageCount: number;
  bagCount: number;
  totalItems: number;
  itemSummary: string; // JSON array
  printedAt: string | null;
  printedBy: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  tenant?: Tenant;
  printedByUser?: User;
  waybillDeliveries?: {
    id: string;
    waybillId: string;
    deliveryId: string;
    delivery?: Delivery;
  }[];
}

export const waybillsApi = {
  getAll: async (params?: {
    page?: number;
    limit?: number;
    status?: string;
    tenantId?: string;
  }): Promise<PaginatedResponse<Waybill>> => {
    const { data } = await api.get<PaginatedResponse<Waybill>>('/waybills', { params });
    return data;
  },

  getById: async (id: string): Promise<Waybill> => {
    const { data } = await api.get<Waybill>(`/waybills/${id}`);
    return data;
  },

  create: async (deliveryIds: string[], bagCount?: number, notes?: string): Promise<Waybill> => {
    const { data } = await api.post<Waybill>('/waybills', { deliveryIds, bagCount, notes });
    return data;
  },

  deliver: async (id: string): Promise<{ success: boolean; message: string }> => {
    const { data } = await api.post(`/waybills/${id}/deliver`);
    return data;
  },
};

// Alerts API
export const alertsApi = {
  getAll: async (params?: {
    page?: number;
    limit?: number;
    unreadOnly?: boolean;
    severity?: string;
    type?: string;
  }): Promise<PaginatedResponse<Alert>> => {
    const { data } = await api.get<PaginatedResponse<Alert>>('/alerts', { params });
    return data;
  },

  getCount: async (): Promise<{ count: number }> => {
    const { data } = await api.get<{ count: number }>('/alerts/count');
    return data;
  },

  markRead: async (id: string): Promise<Alert> => {
    const { data } = await api.patch<Alert>(`/alerts/${id}/read`);
    return data;
  },

  markAllRead: async (): Promise<void> => {
    await api.patch('/alerts/read-all');
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/alerts/${id}`);
  },
};

// Dashboard API
export const dashboardApi = {
  getStats: async (): Promise<DashboardStats> => {
    const { data } = await api.get<DashboardStats>('/dashboard/stats');
    return data;
  },

  getWorkflow: async (): Promise<WorkflowStep[]> => {
    const { data } = await api.get<WorkflowStep[]>('/dashboard/workflow');
    return data;
  },

  getItemTypeDistribution: async (): Promise<Record<string, number>> => {
    const { data } = await api.get<Record<string, number>>('/dashboard/item-types');
    return data;
  },

  getHotelStats: async (): Promise<HotelStats> => {
    const { data } = await api.get<HotelStats>('/dashboard/hotel-stats');
    return data;
  },
};

// Hotel Stats type
export interface HotelStats {
  totalItems: number;
  itemsByStatus: Record<string, number>;
  itemsByType: Record<string, { total: number; atHotel: number; atLaundry: number; inTransit: number }>;
  ageDistribution: { new: number; moderate: number; old: number; veryOld: number };
  washCountDistribution: { low: number; moderate: number; high: number; veryHigh: number };
  avgWashCount: number;
  discrepancies: { damaged: number; stained: number; highWashCount: number; missing: number };
  attentionItems: Array<{
    id: string;
    rfidTag: string;
    itemType: string;
    status: string;
    washCount: number;
    isDamaged: boolean;
    isStained: boolean;
    ageInDays: number;
  }>;
  pickupDeliveryStats: {
    totalPickups: number;
    totalDeliveries: number;
    completedDeliveries: number;
    itemsAtLaundry: number;
    itemsInTransit: number;
  };
}

// Settings API
export const settingsApi = {
  getTenants: async (): Promise<Tenant[]> => {
    const { data } = await api.get<Tenant[]>('/tenants');
    return data;
  },

  createTenant: async (tenant: {
    name: string;
    email: string;
    phone?: string;
    address?: string;
  }): Promise<Tenant> => {
    const { data } = await api.post<Tenant>('/tenants', tenant);
    return data;
  },

  getUsers: async (): Promise<User[]> => {
    const { data } = await api.get<User[]>('/users');
    return data;
  },

  getItemTypes: async (): Promise<ItemType[]> => {
    const { data } = await api.get<ItemType[]>('/item-types');
    return data;
  },

  createItemType: async (itemType: {
    name: string;
    description?: string;
    tenantId?: string;
  }): Promise<ItemType> => {
    const { data } = await api.post<ItemType>('/item-types', itemType);
    return data;
  },
};

// Reports API
export const reportsApi = {
  getLifecycle: async (params?: {
    tenantId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{
    totalItems: number;
    itemsByStatus: Record<string, number>;
    averageWashCount: number;
    itemsByType: Record<string, number>;
  }> => {
    const { data } = await api.get('/reports/lifecycle', { params });
    return data;
  },
};

// Portal API Types
export interface PortalSummary {
  hotel: {
    id: string;
    name: string;
    address: string | null;
    phone: string | null;
  } | null;
  items: {
    total: number;
    atHotel: number;
    atLaundry: number;
    inTransit: number;
    avgWashCount: number;
    damaged: number;
    stained: number;
  };
  deliveries: {
    today: number;
    thisWeek: number;
    thisMonth: number;
    total: number;
    pending: Array<{
      id: string;
      barcode: string;
      status: string;
      createdAt: string;
      driver?: { firstName: string; lastName: string } | null;
    }>;
  };
  pickups: {
    today: number;
    thisWeek: number;
    thisMonth: number;
    total: number;
  };
  attentionItems: Array<{
    id: string;
    rfidTag: string;
    itemType: string | undefined;
    status: string;
    washCount: number;
    isDamaged: boolean;
    isStained: boolean;
  }>;
}

export interface PortalDelivery {
  id: string;
  barcode: string;
  status: string;
  packageCount: number;
  itemCount: number;
  createdAt: string;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  driver: { id: string; name: string } | null;
  items: Array<{
    id: string;
    rfidTag: string;
    itemType: string | undefined;
    status: string;
  }>;
}

export interface PortalPickup {
  id: string;
  bagCode: string;
  sealNumber: string | null;
  status: string;
  itemCount: number;
  createdAt: string;
  receivedAt: string | null;
  driver: { id: string; name: string } | null;
  items: Array<{
    id: string;
    rfidTag: string;
    itemType: string | undefined;
  }>;
}

export interface PortalWaybill {
  id: string;
  waybillNumber: string;
  status: string;
  packageCount: number;
  bagCount: number;
  totalItems: number;
  itemSummary: Record<string, number> | null;
  etaSynced: boolean;
  etaRefNo: string | null;
  createdAt: string;
  printedAt: string | null;
  deliveredAt: string | null;
  deliveryCount: number;
}

export interface PortalItemStatus {
  total: number;
  byStatus: {
    atHotel: number;
    atLaundry: number;
    readyForDelivery: number;
    packaged: number;
    inTransit: number;
    delivered: number;
  };
  byType: Record<string, { total: number; atHotel: number; atLaundry: number; inTransit: number }>;
  lastUpdated: string;
}

export interface PortalActivity {
  type: 'pickup' | 'delivery';
  id: string;
  date: string;
  title: string;
  description: string;
  status: string;
  driver: string | null;
}

// Portal API (for hotel owners)
export const portalApi = {
  getSummary: async (): Promise<PortalSummary> => {
    const { data } = await api.get<PortalSummary>('/portal/summary');
    return data;
  },

  getDeliveries: async (params?: {
    page?: number;
    limit?: number;
    status?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }): Promise<PaginatedResponse<PortalDelivery>> => {
    const { data } = await api.get<PaginatedResponse<PortalDelivery>>('/portal/deliveries', { params });
    return data;
  },

  getPickups: async (params?: {
    page?: number;
    limit?: number;
    status?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<PaginatedResponse<PortalPickup>> => {
    const { data } = await api.get<PaginatedResponse<PortalPickup>>('/portal/pickups', { params });
    return data;
  },

  getWaybills: async (params?: {
    page?: number;
    limit?: number;
    startDate?: string;
    endDate?: string;
    search?: string;
  }): Promise<PaginatedResponse<PortalWaybill>> => {
    const { data } = await api.get<PaginatedResponse<PortalWaybill>>('/portal/waybills', { params });
    return data;
  },

  getWaybillById: async (id: string): Promise<any> => {
    const { data } = await api.get(`/portal/waybills/${id}`);
    return data;
  },

  getItemStatus: async (): Promise<PortalItemStatus> => {
    const { data } = await api.get<PortalItemStatus>('/portal/items/status');
    return data;
  },

  getActivity: async (limit?: number): Promise<PortalActivity[]> => {
    const { data } = await api.get<PortalActivity[]>('/portal/activity', { params: { limit } });
    return data;
  },
};

// ============================================
// NOTIFICATION API TYPES
// ============================================

export type NotificationChannel = 'whatsapp' | 'sms' | 'email' | 'webhook';
export type NotificationEvent =
  | 'delivery_created'
  | 'delivery_packaged'
  | 'delivery_picked_up'
  | 'delivery_delivered'
  | 'pickup_created'
  | 'pickup_received'
  | 'daily_summary'
  | 'alert_new';
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'delivered';

export interface NotificationSetting {
  id: string;
  tenantId: string;
  channel: NotificationChannel;
  isEnabled: boolean;
  whatsappPhoneId?: string;
  whatsappAccessToken?: string;
  whatsappRecipient?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  events: NotificationEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface NotificationTemplate {
  id: string;
  name: string;
  event: NotificationEvent;
  channel: NotificationChannel;
  subject?: string;
  content: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationLog {
  id: string;
  tenantId?: string;
  channel: NotificationChannel;
  event: NotificationEvent;
  recipient: string;
  subject?: string;
  content: string;
  status: NotificationStatus;
  externalId?: string;
  errorMessage?: string;
  sentAt?: string;
  deliveredAt?: string;
  createdAt: string;
}

export interface NotificationStats {
  byStatus: { status: NotificationStatus; count: number }[];
  byChannel: { channel: NotificationChannel; count: number }[];
  recentFailures: NotificationLog[];
}

// Notification API
export const notificationApi = {
  // Settings
  getSettings: async (tenantId: string): Promise<{
    tenant: { notificationEnabled: boolean; notificationPhone?: string };
    settings: NotificationSetting[];
  }> => {
    const { data } = await api.get(`/notifications/settings/${tenantId}`);
    return data;
  },

  saveSettings: async (tenantId: string, settings: Partial<NotificationSetting>): Promise<NotificationSetting> => {
    const { data } = await api.post(`/notifications/settings/${tenantId}`, settings);
    return data;
  },

  deleteSettings: async (tenantId: string, channel: NotificationChannel): Promise<void> => {
    await api.delete(`/notifications/settings/${tenantId}/${channel}`);
  },

  updateTenantSettings: async (tenantId: string, settings: {
    notificationEnabled?: boolean;
    notificationPhone?: string;
  }): Promise<Tenant> => {
    const { data } = await api.patch(`/notifications/tenant/${tenantId}`, settings);
    return data;
  },

  // Templates
  getTemplates: async (): Promise<NotificationTemplate[]> => {
    const { data } = await api.get('/notifications/templates');
    return data;
  },

  createTemplate: async (template: Partial<NotificationTemplate>): Promise<NotificationTemplate> => {
    const { data } = await api.post('/notifications/templates', template);
    return data;
  },

  updateTemplate: async (id: string, template: Partial<NotificationTemplate>): Promise<NotificationTemplate> => {
    const { data } = await api.patch(`/notifications/templates/${id}`, template);
    return data;
  },

  deleteTemplate: async (id: string): Promise<void> => {
    await api.delete(`/notifications/templates/${id}`);
  },

  // Logs
  getLogs: async (params?: {
    tenantId?: string;
    channel?: NotificationChannel;
    status?: NotificationStatus;
    limit?: number;
    offset?: number;
  }): Promise<{
    logs: NotificationLog[];
    total: number;
    limit: number;
    offset: number;
  }> => {
    const { data } = await api.get('/notifications/logs', { params });
    return data;
  },

  // Stats
  getStats: async (tenantId?: string): Promise<NotificationStats> => {
    const { data } = await api.get('/notifications/stats', { params: { tenantId } });
    return data;
  },

  // Test
  sendTest: async (tenantId: string, channel: NotificationChannel, recipient: string): Promise<{
    success: boolean;
    error?: string;
    message?: string;
  }> => {
    const { data } = await api.post('/notifications/test', { tenantId, channel, recipient });
    return data;
  },
};

export default api;
