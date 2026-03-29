import { useState, useEffect } from 'react';
import { WifiOff, CloudOff, Loader2 } from 'lucide-react';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

export function OfflineBanner() {
  const { online } = useNetworkStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [justReconnected, setJustReconnected] = useState(false);

  // Check pending operations count (Electron only)
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.dbGetPendingCount) return;

    const checkPending = async () => {
      try {
        const result = await api.dbGetPendingCount();
        if (result.success) setPendingCount(result.count);
      } catch { /* ignore */ }
    };

    checkPending();
    const interval = setInterval(checkPending, 5000);
    return () => clearInterval(interval);
  }, [online]);

  // Show "reconnected" message briefly when coming back online
  useEffect(() => {
    if (online && pendingCount > 0) {
      setJustReconnected(true);
      const timeout = setTimeout(() => setJustReconnected(false), 5000);
      return () => clearTimeout(timeout);
    }
    setJustReconnected(false);
  }, [online]);

  if (online && justReconnected && pendingCount > 0) {
    return (
      <div className="bg-yellow-500 text-white px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2 sticky top-0 z-50">
        <Loader2 className="w-4 h-4 animate-spin" />
        Internet geldi - {pendingCount} bekleyen islem gonderiliyor...
      </div>
    );
  }

  if (online) return null;

  const hasElectron = !!(window as any).electronAPI?.dbGetDeliveries;

  return (
    <div className="bg-red-600 text-white px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2 sticky top-0 z-50">
      {hasElectron ? <CloudOff className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
      {hasElectron
        ? `Internet baglantisi yok - Yerel veritabanindan calisiyor${pendingCount > 0 ? ` (${pendingCount} bekleyen islem)` : ''}. Baglanti geldiginde otomatik senkronize edilecek.`
        : 'Internet baglantisi yok - Veriler guncellenmeyecek. Baglanti geldiginde otomatik devam edecek.'
      }
    </div>
  );
}
