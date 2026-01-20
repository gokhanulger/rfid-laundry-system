import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { getStoredToken } from '../lib/api';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  connectionError: string | null;
  reconnect: () => void;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  connectionError: null,
  reconnect: () => {},
});

export function useSocket() {
  return useContext(SocketContext);
}

// Check if running in Electron
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

// Socket server URL
const socketUrl = isViteDevServer && !isElectronApp
  ? 'http://localhost:3001'
  : 'https://rfid-laundry-backend-production.up.railway.app';

interface SocketProviderProps {
  children: ReactNode;
}

export function SocketProvider({ children }: SocketProviderProps) {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const createConnection = useCallback(() => {
    const token = getStoredToken();
    if (!token || !user) {
      return null;
    }

    const newSocket = io(socketUrl, {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    newSocket.on('connect', () => {
      console.log('Socket connected:', newSocket.id);
      setIsConnected(true);
      setConnectionError(null);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      setIsConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message);
      setConnectionError(error.message);
      setIsConnected(false);
    });

    newSocket.on('error', (error) => {
      console.error('Socket error:', error);
      setConnectionError(error.message || 'Socket error');
    });

    return newSocket;
  }, [user]);

  const reconnect = useCallback(() => {
    if (socket) {
      socket.disconnect();
    }
    const newSocket = createConnection();
    if (newSocket) {
      setSocket(newSocket);
    }
  }, [socket, createConnection]);

  useEffect(() => {
    // Only connect if user is authenticated
    if (!user) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
      return;
    }

    const newSocket = createConnection();
    if (newSocket) {
      setSocket(newSocket);
    }

    return () => {
      if (newSocket) {
        newSocket.disconnect();
      }
    };
  }, [user, createConnection]);

  return (
    <SocketContext.Provider value={{ socket, isConnected, connectionError, reconnect }}>
      {children}
    </SocketContext.Provider>
  );
}
