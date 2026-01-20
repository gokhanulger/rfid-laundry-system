import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket } from '../contexts/SocketContext';

// Event types
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

interface RealtimeOptions {
  onItemStatusChanged?: (data: { itemId: string; status: string; tenantId: string }) => void;
  onDeliveryUpdated?: (data: { deliveryId: string; status: string; tenantId: string }) => void;
  onPickupUpdated?: (data: { pickupId: string; status: string; tenantId: string }) => void;
  onAlertNew?: (data: { id: string; type: string; severity: string; title: string }) => void;
  onDashboardUpdate?: (data: { tenantId?: string; stats?: Record<string, any> }) => void;
  onScanProgress?: (data: { sessionId: string; scannedCount: number; totalCount?: number }) => void;
  invalidateOnEvents?: boolean; // Auto-invalidate queries on events
}

export function useRealtime(options: RealtimeOptions = {}) {
  const { socket, isConnected } = useSocket();
  const queryClient = useQueryClient();

  const {
    onItemStatusChanged,
    onDeliveryUpdated,
    onPickupUpdated,
    onAlertNew,
    onDashboardUpdate,
    onScanProgress,
    invalidateOnEvents = true,
  } = options;

  useEffect(() => {
    if (!socket || !isConnected) return;

    // Item status changed
    const handleItemStatusChanged = (data: { itemId: string; status: string; tenantId: string }) => {
      if (invalidateOnEvents) {
        queryClient.invalidateQueries({ queryKey: ['items'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['portal'] });
      }
      onItemStatusChanged?.(data);
    };

    // Delivery updated
    const handleDeliveryUpdated = (data: { deliveryId: string; status: string; tenantId: string }) => {
      if (invalidateOnEvents) {
        queryClient.invalidateQueries({ queryKey: ['deliveries'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['portal'] });
      }
      onDeliveryUpdated?.(data);
    };

    // Delivery created
    const handleDeliveryCreated = () => {
      if (invalidateOnEvents) {
        queryClient.invalidateQueries({ queryKey: ['deliveries'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['portal'] });
      }
    };

    // Pickup updated
    const handlePickupUpdated = (data: { pickupId: string; status: string; tenantId: string }) => {
      if (invalidateOnEvents) {
        queryClient.invalidateQueries({ queryKey: ['pickups'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['portal'] });
      }
      onPickupUpdated?.(data);
    };

    // Pickup created
    const handlePickupCreated = () => {
      if (invalidateOnEvents) {
        queryClient.invalidateQueries({ queryKey: ['pickups'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['portal'] });
      }
    };

    // Alert new
    const handleAlertNew = (data: { id: string; type: string; severity: string; title: string }) => {
      if (invalidateOnEvents) {
        queryClient.invalidateQueries({ queryKey: ['alerts'] });
      }
      onAlertNew?.(data);
    };

    // Dashboard update
    const handleDashboardUpdate = (data: { tenantId?: string; stats?: Record<string, any> }) => {
      if (invalidateOnEvents) {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['portal'] });
        queryClient.invalidateQueries({ queryKey: ['hotel-status'] });
      }
      onDashboardUpdate?.(data);
    };

    // Scan progress
    const handleScanProgress = (data: { sessionId: string; scannedCount: number; totalCount?: number }) => {
      onScanProgress?.(data);
    };

    // Waybill events
    const handleWaybillUpdated = () => {
      if (invalidateOnEvents) {
        queryClient.invalidateQueries({ queryKey: ['waybills'] });
        queryClient.invalidateQueries({ queryKey: ['portal', 'waybills'] });
      }
    };

    // Subscribe to events
    socket.on('item:statusChanged', handleItemStatusChanged);
    socket.on('item:created', handleItemStatusChanged);
    socket.on('delivery:updated', handleDeliveryUpdated);
    socket.on('delivery:created', handleDeliveryCreated);
    socket.on('pickup:updated', handlePickupUpdated);
    socket.on('pickup:created', handlePickupCreated);
    socket.on('alert:new', handleAlertNew);
    socket.on('dashboard:update', handleDashboardUpdate);
    socket.on('scan:progress', handleScanProgress);
    socket.on('scan:completed', handleScanProgress);
    socket.on('waybill:created', handleWaybillUpdated);
    socket.on('waybill:updated', handleWaybillUpdated);

    return () => {
      socket.off('item:statusChanged', handleItemStatusChanged);
      socket.off('item:created', handleItemStatusChanged);
      socket.off('delivery:updated', handleDeliveryUpdated);
      socket.off('delivery:created', handleDeliveryCreated);
      socket.off('pickup:updated', handlePickupUpdated);
      socket.off('pickup:created', handlePickupCreated);
      socket.off('alert:new', handleAlertNew);
      socket.off('dashboard:update', handleDashboardUpdate);
      socket.off('scan:progress', handleScanProgress);
      socket.off('scan:completed', handleScanProgress);
      socket.off('waybill:created', handleWaybillUpdated);
      socket.off('waybill:updated', handleWaybillUpdated);
    };
  }, [socket, isConnected, queryClient, invalidateOnEvents, onItemStatusChanged, onDeliveryUpdated, onPickupUpdated, onAlertNew, onDashboardUpdate, onScanProgress]);

  // Join/leave tenant rooms (for admins)
  const joinTenant = useCallback((tenantId: string) => {
    if (socket && isConnected) {
      socket.emit('join:tenant', tenantId);
    }
  }, [socket, isConnected]);

  const leaveTenant = useCallback((tenantId: string) => {
    if (socket && isConnected) {
      socket.emit('leave:tenant', tenantId);
    }
  }, [socket, isConnected]);

  return {
    isConnected,
    joinTenant,
    leaveTenant,
  };
}
