import { useState, useEffect, useCallback } from 'react';

let listeners: Array<(online: boolean) => void> = [];
let isOnline = navigator.onLine;

// Shared network status - all components see the same state
function notifyListeners(online: boolean) {
  isOnline = online;
  listeners.forEach(fn => fn(online));
}

window.addEventListener('online', () => notifyListeners(true));
window.addEventListener('offline', () => notifyListeners(false));

export function useNetworkStatus() {
  const [online, setOnline] = useState(isOnline);

  useEffect(() => {
    const handler = (val: boolean) => setOnline(val);
    listeners.push(handler);
    // Sync in case state changed before mount
    setOnline(isOnline);
    return () => {
      listeners = listeners.filter(fn => fn !== handler);
    };
  }, []);

  const checkConnection = useCallback(async (): Promise<boolean> => {
    try {
      // Try a lightweight request to verify actual connectivity
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      await fetch(window.location.origin, {
        method: 'HEAD',
        mode: 'no-cors',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return true;
    } catch {
      return false;
    }
  }, []);

  return { online, checkConnection };
}

// Export for non-hook contexts
export function getNetworkStatus() {
  return isOnline;
}
