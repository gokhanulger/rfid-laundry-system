// User types
export type UserRole = 'hotel_owner' | 'laundry_manager' | 'operator' | 'driver' | 'packager' | 'ironer' | 'auditor' | 'system_admin';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  tenantId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Tenant types
export interface Tenant {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Item types
export type ItemStatus =
  | 'at_hotel'
  | 'at_laundry'
  | 'processing'
  | 'ready_for_delivery'
  | 'label_printed'
  | 'packaged'
  | 'in_transit'
  | 'delivered';

export interface ItemType {
  id: string;
  name: string;
  description: string | null;
  tenantId: string | null;
  createdAt: string;
}

export interface Item {
  id: string;
  rfidTag: string;
  itemTypeId: string;
  tenantId: string;
  status: ItemStatus;
  washCount: number;
  location: string | null;
  isDamaged: boolean;
  isStained: boolean;
  notes: string | null;
  lastWashDate: string | null;
  createdAt: string;
  updatedAt: string;
  itemType?: ItemType;
  tenant?: Tenant;
}

// Pickup types
export type PickupStatus = 'created' | 'received' | 'processed';

export interface PickupItem {
  id: string;
  pickupId: string;
  itemId: string;
  createdAt: string;
  item?: Item;
}

export interface Pickup {
  id: string;
  tenantId: string;
  driverId: string | null;
  bagCode: string;
  sealNumber: string;
  status: PickupStatus;
  pickupDate: string;
  receivedDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  tenant?: Tenant;
  driver?: User;
  pickupItems?: PickupItem[];
}

// Delivery types
export type DeliveryStatus = 'created' | 'label_printed' | 'packaged' | 'picked_up' | 'delivered';
export type PackageStatus = 'created' | 'scanned' | 'picked_up';

export interface DeliveryItem {
  id: string;
  deliveryId: string;
  itemId: string;
  createdAt: string;
  item?: Item;
}

export interface DeliveryPackage {
  id: string;
  deliveryId: string;
  packageBarcode: string;
  sequenceNumber: number;
  status: PackageStatus;
  scannedAt: string | null;
  scannedBy: string | null;
  pickedUpAt: string | null;
  createdAt: string;
  scannedByUser?: User;
}

export interface Delivery {
  id: string;
  tenantId: string;
  driverId: string | null;
  packagerId: string | null;
  barcode: string;
  packageCount: number;
  status: DeliveryStatus;
  labelPrintedAt: string | null;
  packagedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  deliveryLatitude: string | null;
  deliveryLongitude: string | null;
  deliveryAddress: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  tenant?: Tenant;
  driver?: User;
  packager?: User;
  deliveryItems?: DeliveryItem[];
  deliveryPackages?: DeliveryPackage[];
}

// Alert types
export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';
export type AlertType = 'missing_item' | 'dwell_time' | 'damaged_item' | 'stained_item' | 'high_wash_count' | 'system';

export interface Alert {
  id: string;
  tenantId: string | null;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  itemId: string | null;
  isRead: boolean;
  createdAt: string;
  item?: Item;
}

// API response types
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface DashboardStats {
  itemsByStatus: Record<ItemStatus, number>;
  totalItems: number;
  workflowSummary: {
    atHotel: number;
    atLaundry: number;
    processing: number;
    readyForDelivery: number;
    labelPrinted: number;
    packaged: number;
    inTransit: number;
    delivered: number;
  };
  attentionItems: Item[];
  recentPickups: Pickup[];
  recentDeliveries: Delivery[];
  unreadAlerts: number;
  todayActivity: {
    pickups: number;
    deliveries: number;
  };
}

export interface WorkflowStep {
  step: number;
  name: string;
  status: ItemStatus;
  count: number;
}

// Form types
export interface LoginForm {
  email: string;
  password: string;
}

export interface CreatePickupForm {
  tenantId: string;
  bagCode: string;
  sealNumber?: string;
  itemIds?: string[];
  notes?: string;
}

export interface CreateDeliveryForm {
  tenantId: string;
  itemIds: string[];
  packageCount: number;
  notes?: string;
}

export interface CreateItemForm {
  rfidTag: string;
  itemTypeId: string;
  tenantId: string;
  status?: ItemStatus;
  location?: string;
  notes?: string;
}

// API Error
export interface ApiError {
  error: string;
  details?: Array<{ message: string; path: string[] }>;
}
