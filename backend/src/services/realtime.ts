import { emitToTenant, emitToAdmins } from './socket';
import logger from '../utils/logger';

// Event types for real-time updates
export type RealtimeEvent =
  | 'item:statusChanged'
  | 'item:created'
  | 'item:updated'
  | 'delivery:created'
  | 'delivery:updated'
  | 'delivery:statusChanged'
  | 'pickup:created'
  | 'pickup:updated'
  | 'scan:progress'
  | 'scan:completed'
  | 'alert:new'
  | 'dashboard:update'
  | 'waybill:created'
  | 'waybill:updated';

// Item status change
export function emitItemStatusChanged(itemId: string, status: string, tenantId: string, oldStatus?: string): void {
  const data = { itemId, status, oldStatus, tenantId, timestamp: new Date().toISOString() };
  emitToTenant(tenantId, 'item:statusChanged', data);
  emitToAdmins('item:statusChanged', data);
  logger.info(`Realtime: item:statusChanged - ${itemId} to ${status}`);
}

// Item created
export function emitItemCreated(item: { id: string; rfidTag: string; tenantId: string; status: string }): void {
  const data = { ...item, timestamp: new Date().toISOString() };
  emitToTenant(item.tenantId, 'item:created', data);
  emitToAdmins('item:created', data);
}

// Delivery updates
export function emitDeliveryCreated(delivery: { id: string; barcode: string; tenantId: string; status: string; itemCount: number }): void {
  const data = { ...delivery, timestamp: new Date().toISOString() };
  emitToTenant(delivery.tenantId, 'delivery:created', data);
  emitToAdmins('delivery:created', data);
  logger.info(`Realtime: delivery:created - ${delivery.barcode}`);
}

export function emitDeliveryUpdated(deliveryId: string, tenantId: string, status: string, updates?: Record<string, any>): void {
  const data = { deliveryId, tenantId, status, ...updates, timestamp: new Date().toISOString() };
  emitToTenant(tenantId, 'delivery:updated', data);
  emitToAdmins('delivery:updated', data);
  logger.info(`Realtime: delivery:updated - ${deliveryId} to ${status}`);
}

// Pickup updates
export function emitPickupCreated(pickup: { id: string; bagCode: string; tenantId: string; status: string; itemCount: number }): void {
  const data = { ...pickup, timestamp: new Date().toISOString() };
  emitToTenant(pickup.tenantId, 'pickup:created', data);
  emitToAdmins('pickup:created', data);
  logger.info(`Realtime: pickup:created - ${pickup.bagCode}`);
}

export function emitPickupUpdated(pickupId: string, tenantId: string, status: string, updates?: Record<string, any>): void {
  const data = { pickupId, tenantId, status, ...updates, timestamp: new Date().toISOString() };
  emitToTenant(tenantId, 'pickup:updated', data);
  emitToAdmins('pickup:updated', data);
  logger.info(`Realtime: pickup:updated - ${pickupId} to ${status}`);
}

// Scan progress (for bulk operations)
export function emitScanProgress(sessionId: string, tenantId: string, scannedCount: number, totalCount?: number): void {
  const data = { sessionId, tenantId, scannedCount, totalCount, timestamp: new Date().toISOString() };
  emitToTenant(tenantId, 'scan:progress', data);
  emitToAdmins('scan:progress', data);
}

export function emitScanCompleted(sessionId: string, tenantId: string, totalScanned: number, results: { found: number; notFound: number }): void {
  const data = { sessionId, tenantId, totalScanned, ...results, timestamp: new Date().toISOString() };
  emitToTenant(tenantId, 'scan:completed', data);
  emitToAdmins('scan:completed', data);
}

// Alert
export function emitNewAlert(alert: { id: string; tenantId: string | null; type: string; severity: string; title: string }): void {
  const data = { ...alert, timestamp: new Date().toISOString() };
  if (alert.tenantId) {
    emitToTenant(alert.tenantId, 'alert:new', data);
  }
  emitToAdmins('alert:new', data);
  logger.info(`Realtime: alert:new - ${alert.title}`);
}

// Dashboard update (general stats refresh signal)
export function emitDashboardUpdate(tenantId?: string, stats?: Record<string, any>): void {
  const data = { tenantId, stats, timestamp: new Date().toISOString() };
  if (tenantId) {
    emitToTenant(tenantId, 'dashboard:update', data);
  }
  emitToAdmins('dashboard:update', data);
}

// Waybill updates
export function emitWaybillCreated(waybill: { id: string; waybillNumber: string; tenantId: string; totalItems: number }): void {
  const data = { ...waybill, timestamp: new Date().toISOString() };
  emitToTenant(waybill.tenantId, 'waybill:created', data);
  emitToAdmins('waybill:created', data);
  logger.info(`Realtime: waybill:created - ${waybill.waybillNumber}`);
}

export function emitWaybillUpdated(waybillId: string, tenantId: string, status: string): void {
  const data = { waybillId, tenantId, status, timestamp: new Date().toISOString() };
  emitToTenant(tenantId, 'waybill:updated', data);
  emitToAdmins('waybill:updated', data);
}
