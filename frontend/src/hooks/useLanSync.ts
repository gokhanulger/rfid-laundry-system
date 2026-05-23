import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Hook that listens for delivery data changes from ALL sources:
 * - LAN sync (other computers on same network)
 * - Auto-sync (periodic API sync from main process)
 * - Local changes (package, cancel, etc.)
 *
 * Invalidates React Query caches so the UI refreshes automatically.
 */
export function useLanSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;

    const cleanups: (() => void)[] = [];

    // Listen for LAN peer delivery updates
    if (api.onLanDeliveryUpdated) {
      const cleanup = api.onLanDeliveryUpdated((data: { deliveryId: string; status: string }) => {
        console.log('[Sync] LAN delivery updated:', data.deliveryId, '->', data.status);
        queryClient.invalidateQueries({ queryKey: ['deliveries'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      });
      cleanups.push(cleanup);
    }

    // Listen for deliveries-changed from main process (auto-sync, API sync, local changes)
    if (api.onDeliveriesChanged) {
      const cleanup = api.onDeliveriesChanged((data: { source: string; timestamp: number }) => {
        console.log('[Sync] Deliveries changed (source:', data.source, ')');
        queryClient.invalidateQueries({ queryKey: ['deliveries'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      });
      cleanups.push(cleanup);
    }

    return () => {
      cleanups.forEach(fn => fn());
    };
  }, [queryClient]);
}
