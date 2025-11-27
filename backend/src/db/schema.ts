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
  email: text('email').notNull(),
  phone: text('phone'),
  address: text('address'),
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
  notes: text('notes'),
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

