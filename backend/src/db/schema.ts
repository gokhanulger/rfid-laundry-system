import { pgTable, text, integer, timestamp, boolean, uuid, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums
export const userRoleEnum = pgEnum('user_role', [
  'hotel_owner',
  'laundry_manager',
  'operator',
  'driver',
  'packager',
  'ironer',
  'auditor',
  'system_admin'
]);

export const itemStatusEnum = pgEnum('item_status', [
  'at_hotel',
  'at_laundry',
  'processing',
  'ready_for_delivery',
  'label_printed',
  'packaged',
  'in_transit',
  'delivered'
]);

export const pickupStatusEnum = pgEnum('pickup_status', [
  'created',
  'received',
  'processed'
]);

export const deliveryStatusEnum = pgEnum('delivery_status', [
  'created',
  'label_printed',
  'packaged',
  'picked_up',
  'delivered'
]);

export const packageStatusEnum = pgEnum('package_status', [
  'created',
  'scanned',
  'picked_up'
]);

// Scan-related enums
export const scanSessionTypeEnum = pgEnum('scan_session_type', [
  'pickup',        // Dirty items at hotel
  'receive',       // Items arriving at laundry
  'process',       // Items entering wash
  'clean',         // Items after ironing
  'package',       // Items being packaged
  'deliver'        // Items delivered to hotel
]);

export const scanSessionStatusEnum = pgEnum('scan_session_status', [
  'in_progress',
  'completed',
  'synced',
  'cancelled'
]);

export const syncStatusEnum = pgEnum('sync_status', [
  'pending',
  'synced',
  'conflict',
  'resolved'
]);

export const offlineSyncStatusEnum = pgEnum('offline_sync_status', [
  'pending',
  'processing',
  'completed',
  'failed'
]);

export const waybillStatusEnum = pgEnum('waybill_status', [
  'created',
  'printed',
  'picked_up',
  'delivered'
]);

// Users table
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  role: userRoleEnum('role').notNull(),
  tenantId: uuid('tenant_id'), // null for system_admin
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Tenants (Hotels)
export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  latitude: text('latitude'), // Hotel GPS latitude
  longitude: text('longitude'), // Hotel GPS longitude
  qrCode: text('qr_code').unique(), // Unique QR code for quick hotel identification
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Item Types
export const itemTypes = pgTable('item_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(), // e.g., "Towel", "Sheet", "Pillowcase"
  description: text('description'),
  tenantId: uuid('tenant_id'), // null for global types
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Items (Textiles with RFID tags)
export const items = pgTable('items', {
  id: uuid('id').defaultRandom().primaryKey(),
  rfidTag: text('rfid_tag').notNull().unique(),
  itemTypeId: uuid('item_type_id').notNull().references(() => itemTypes.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  status: itemStatusEnum('status').default('at_hotel').notNull(),
  washCount: integer('wash_count').default(0).notNull(),
  location: text('location'), // Current physical location
  isDamaged: boolean('is_damaged').default(false).notNull(),
  isStained: boolean('is_stained').default(false).notNull(),
  notes: text('notes'),
  lastWashDate: timestamp('last_wash_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Pickups (Dirty items collected from hotels)
export const pickups = pgTable('pickups', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  driverId: uuid('driver_id').references(() => users.id),
  bagCode: text('bag_code').notNull(),
  sealNumber: text('seal_number'),
  status: pickupStatusEnum('status').default('created').notNull(),
  pickupDate: timestamp('pickup_date').defaultNow().notNull(),
  receivedDate: timestamp('received_date'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Pickup Items (Many-to-many relationship)
export const pickupItems = pgTable('pickup_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  pickupId: uuid('pickup_id').notNull().references(() => pickups.id),
  itemId: uuid('item_id').notNull().references(() => items.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Deliveries (Clean items to be delivered to hotels)
export const deliveries = pgTable('deliveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  driverId: uuid('driver_id').references(() => users.id),
  packagerId: uuid('packager_id').references(() => users.id),
  barcode: text('barcode').notNull().unique(),
  packageCount: integer('package_count').default(1).notNull(), // Number of physical packages
  status: deliveryStatusEnum('status').default('created').notNull(),
  labelPrintedAt: timestamp('label_printed_at'),
  packagedAt: timestamp('packaged_at'),
  pickedUpAt: timestamp('picked_up_at'),
  deliveredAt: timestamp('delivered_at'),
  deliveryLatitude: text('delivery_latitude'), // Location where delivery was completed
  deliveryLongitude: text('delivery_longitude'),
  deliveryAddress: text('delivery_address'), // Optional human-readable address
  bagCode: text('bag_code'), // Bag code for grouping multiple deliveries for driver
  notes: text('notes'),
  etaSynced: boolean('eta_synced').default(false), // Whether synced to ETA accounting system
  etaRefNo: text('eta_ref_no'), // Reference number from ETA system
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Delivery Items (Many-to-many relationship)
export const deliveryItems = pgTable('delivery_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  deliveryId: uuid('delivery_id').notNull().references(() => deliveries.id),
  itemId: uuid('item_id').notNull().references(() => items.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Waybills (Irsaliye - groups multiple deliveries/packages)
export const waybills = pgTable('waybills', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  waybillNumber: text('waybill_number').notNull().unique(), // A-123456789
  status: waybillStatusEnum('status').default('created').notNull(),
  packageCount: integer('package_count').default(0).notNull(),
  bagCount: integer('bag_count').default(0).notNull(),
  totalItems: integer('total_items').default(0).notNull(),
  itemSummary: text('item_summary'), // JSON: [{typeName: "Havlu", count: 10}, ...]
  printedAt: timestamp('printed_at'),
  printedBy: uuid('printed_by').references(() => users.id),
  pickedUpAt: timestamp('picked_up_at'),
  deliveredAt: timestamp('delivered_at'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Waybill Deliveries (Many-to-many: which deliveries are in this waybill)
export const waybillDeliveries = pgTable('waybill_deliveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  waybillId: uuid('waybill_id').notNull().references(() => waybills.id),
  deliveryId: uuid('delivery_id').notNull().references(() => deliveries.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Delivery Packages (Individual packages within a delivery)
export const deliveryPackages = pgTable('delivery_packages', {
  id: uuid('id').defaultRandom().primaryKey(),
  deliveryId: uuid('delivery_id').notNull().references(() => deliveries.id),
  packageBarcode: text('package_barcode').notNull().unique(),
  sequenceNumber: integer('sequence_number').notNull(), // 1, 2, 3, etc.
  status: packageStatusEnum('status').default('created').notNull(),
  scannedAt: timestamp('scanned_at'),
  scannedBy: uuid('scanned_by').references(() => users.id),
  pickedUpAt: timestamp('picked_up_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Alerts
export const alerts = pgTable('alerts', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id), // null for system-wide alerts
  type: text('type').notNull(), // 'missing_item', 'dwell_time', 'damaged_item', etc.
  severity: text('severity').notNull(), // 'low', 'medium', 'high', 'critical'
  title: text('title').notNull(),
  message: text('message').notNull(),
  itemId: uuid('item_id').references(() => items.id),
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Audit Log
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  action: text('action').notNull(), // 'item_scanned', 'status_changed', 'pickup_created', etc.
  entityType: text('entity_type').notNull(), // 'item', 'pickup', 'delivery', etc.
  entityId: uuid('entity_id'),
  details: text('details'), // JSON string with additional details
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================
// RFID SCANNING TABLES
// ============================================

// Registered Android/handheld devices
export const devices = pgTable('devices', {
  id: uuid('id').defaultRandom().primaryKey(),
  deviceUuid: text('device_uuid').notNull().unique(), // Android device unique ID
  name: text('name').notNull(), // Human-readable name: "Driver 1 Scanner"
  userId: uuid('user_id').references(() => users.id), // Assigned user
  tenantId: uuid('tenant_id').references(() => tenants.id), // Multi-tenant isolation
  lastSyncAt: timestamp('last_sync_at'),
  lastSeenAt: timestamp('last_seen_at'),
  appVersion: text('app_version'), // Track app version for updates
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Scanning sessions (each pickup/delivery operation is a session)
export const scanSessions = pgTable('scan_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  deviceId: uuid('device_id').references(() => devices.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  sessionType: scanSessionTypeEnum('session_type').notNull(),
  status: scanSessionStatusEnum('status').default('in_progress').notNull(),
  // Link to related entity (pickup, delivery, etc.)
  relatedEntityType: text('related_entity_type'), // 'pickup', 'delivery', etc.
  relatedEntityId: uuid('related_entity_id'),
  // Session metadata
  metadata: text('metadata'), // JSON: bagCode, sealNumber, GPS coords, etc.
  itemCount: integer('item_count').default(0).notNull(),
  // Location data
  latitude: text('latitude'),
  longitude: text('longitude'),
  // Timestamps
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  syncedAt: timestamp('synced_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Individual tag scans within a session
export const scanEvents = pgTable('scan_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => scanSessions.id),
  rfidTag: text('rfid_tag').notNull(),
  itemId: uuid('item_id').references(() => items.id), // Linked after processing
  signalStrength: integer('signal_strength'), // RSSI value from reader
  readCount: integer('read_count').default(1).notNull(), // How many times tag was read in session
  syncStatus: syncStatusEnum('sync_status').default('pending').notNull(),
  scannedAt: timestamp('scanned_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Queue for offline syncs from Android devices
export const offlineSyncQueue = pgTable('offline_sync_queue', {
  id: uuid('id').defaultRandom().primaryKey(),
  deviceId: uuid('device_id').notNull().references(() => devices.id),
  sessionData: text('session_data').notNull(), // JSON: full session + events
  status: offlineSyncStatusEnum('status').default('pending').notNull(),
  errorMessage: text('error_message'),
  retryCount: integer('retry_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at'),
});

// Track conflicts when same tag scanned by multiple devices
export const scanConflicts = pgTable('scan_conflicts', {
  id: uuid('id').defaultRandom().primaryKey(),
  rfidTag: text('rfid_tag').notNull(),
  winningSessionId: uuid('winning_session_id').references(() => scanSessions.id),
  conflictingSessionId: uuid('conflicting_session_id').references(() => scanSessions.id),
  winningDeviceId: uuid('winning_device_id').references(() => devices.id),
  conflictingDeviceId: uuid('conflicting_device_id').references(() => devices.id),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  resolution: text('resolution'), // 'auto_first_wins', 'manual_override', etc.
  isResolved: boolean('is_resolved').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
});

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
  pickups: many(pickups),
  deliveries: many(deliveries),
  auditLogs: many(auditLogs),
}));

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  items: many(items),
  pickups: many(pickups),
  deliveries: many(deliveries),
  alerts: many(alerts),
}));

export const itemsRelations = relations(items, ({ one, many }) => ({
  itemType: one(itemTypes, {
    fields: [items.itemTypeId],
    references: [itemTypes.id],
  }),
  tenant: one(tenants, {
    fields: [items.tenantId],
    references: [tenants.id],
  }),
  pickupItems: many(pickupItems),
  deliveryItems: many(deliveryItems),
  alerts: many(alerts),
}));

export const pickupsRelations = relations(pickups, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [pickups.tenantId],
    references: [tenants.id],
  }),
  driver: one(users, {
    fields: [pickups.driverId],
    references: [users.id],
  }),
  pickupItems: many(pickupItems),
}));

export const deliveriesRelations = relations(deliveries, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [deliveries.tenantId],
    references: [tenants.id],
  }),
  driver: one(users, {
    fields: [deliveries.driverId],
    references: [users.id],
  }),
  packager: one(users, {
    fields: [deliveries.packagerId],
    references: [users.id],
  }),
  deliveryItems: many(deliveryItems),
  deliveryPackages: many(deliveryPackages),
}));

export const pickupItemsRelations = relations(pickupItems, ({ one }) => ({
  pickup: one(pickups, {
    fields: [pickupItems.pickupId],
    references: [pickups.id],
  }),
  item: one(items, {
    fields: [pickupItems.itemId],
    references: [items.id],
  }),
}));

export const deliveryItemsRelations = relations(deliveryItems, ({ one }) => ({
  delivery: one(deliveries, {
    fields: [deliveryItems.deliveryId],
    references: [deliveries.id],
  }),
  item: one(items, {
    fields: [deliveryItems.itemId],
    references: [items.id],
  }),
}));

export const deliveryPackagesRelations = relations(deliveryPackages, ({ one }) => ({
  delivery: one(deliveries, {
    fields: [deliveryPackages.deliveryId],
    references: [deliveries.id],
  }),
  scannedByUser: one(users, {
    fields: [deliveryPackages.scannedBy],
    references: [users.id],
  }),
}));

export const itemTypesRelations = relations(itemTypes, ({ many }) => ({
  items: many(items),
}));

export const alertsRelations = relations(alerts, ({ one }) => ({
  tenant: one(tenants, {
    fields: [alerts.tenantId],
    references: [tenants.id],
  }),
  item: one(items, {
    fields: [alerts.itemId],
    references: [items.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
  tenant: one(tenants, {
    fields: [auditLogs.tenantId],
    references: [tenants.id],
  }),
}));

// Waybill relations
export const waybillsRelations = relations(waybills, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [waybills.tenantId],
    references: [tenants.id],
  }),
  printedByUser: one(users, {
    fields: [waybills.printedBy],
    references: [users.id],
  }),
  waybillDeliveries: many(waybillDeliveries),
}));

export const waybillDeliveriesRelations = relations(waybillDeliveries, ({ one }) => ({
  waybill: one(waybills, {
    fields: [waybillDeliveries.waybillId],
    references: [waybills.id],
  }),
  delivery: one(deliveries, {
    fields: [waybillDeliveries.deliveryId],
    references: [deliveries.id],
  }),
}));

// ============================================
// RFID SCANNING RELATIONS
// ============================================

export const devicesRelations = relations(devices, ({ one, many }) => ({
  user: one(users, {
    fields: [devices.userId],
    references: [users.id],
  }),
  tenant: one(tenants, {
    fields: [devices.tenantId],
    references: [tenants.id],
  }),
  scanSessions: many(scanSessions),
  offlineSyncQueue: many(offlineSyncQueue),
}));

export const scanSessionsRelations = relations(scanSessions, ({ one, many }) => ({
  device: one(devices, {
    fields: [scanSessions.deviceId],
    references: [devices.id],
  }),
  user: one(users, {
    fields: [scanSessions.userId],
    references: [users.id],
  }),
  tenant: one(tenants, {
    fields: [scanSessions.tenantId],
    references: [tenants.id],
  }),
  scanEvents: many(scanEvents),
}));

export const scanEventsRelations = relations(scanEvents, ({ one }) => ({
  session: one(scanSessions, {
    fields: [scanEvents.sessionId],
    references: [scanSessions.id],
  }),
  item: one(items, {
    fields: [scanEvents.itemId],
    references: [items.id],
  }),
}));

export const offlineSyncQueueRelations = relations(offlineSyncQueue, ({ one }) => ({
  device: one(devices, {
    fields: [offlineSyncQueue.deviceId],
    references: [devices.id],
  }),
}));

export const scanConflictsRelations = relations(scanConflicts, ({ one }) => ({
  winningSession: one(scanSessions, {
    fields: [scanConflicts.winningSessionId],
    references: [scanSessions.id],
  }),
  conflictingSession: one(scanSessions, {
    fields: [scanConflicts.conflictingSessionId],
    references: [scanSessions.id],
  }),
  winningDevice: one(devices, {
    fields: [scanConflicts.winningDeviceId],
    references: [devices.id],
  }),
  conflictingDevice: one(devices, {
    fields: [scanConflicts.conflictingDeviceId],
    references: [devices.id],
  }),
  resolvedByUser: one(users, {
    fields: [scanConflicts.resolvedBy],
    references: [users.id],
  }),
}));

