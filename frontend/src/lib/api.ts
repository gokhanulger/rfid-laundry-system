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

// VITE_API_URL should be the full API base URL including /api
// e.g., https://rfid-laundry-backend-production.up.railway.app/api
const apiBaseUrl = import.meta.env.VITE_API_URL || '/api';

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

// Log the API URL in development for debugging
if (import.meta.env.DEV) {
  console.log('API Base URL:', apiBaseUrl);
}

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

  deliver: async (id: string): Promise<Delivery> => {
    const { data } = await api.post<Delivery>(`/deliveries/${id}/deliver`);
    return data;
  },

  cancel: async (id: string): Promise<void> => {
    await api.post(`/deliveries/${id}/cancel`);
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

export default api;
