import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import api, { getStoredToken, setStoredToken, removeStoredToken } from '../lib/api';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId?: string;
  tenantName?: string;
  token?: string;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
  isImpersonating: boolean;
  impersonate: (tenantId: string) => Promise<void>;
  stopImpersonation: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Backup key holding the admin's own token while impersonating a hotel
const ADMIN_TOKEN_BACKUP_KEY = 'rfid_admin_token_backup';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImpersonating, setIsImpersonating] = useState(
    () => !!localStorage.getItem(ADMIN_TOKEN_BACKUP_KEY)
  );

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    // Check if we have a stored token
    const token = getStoredToken();
    if (!token) {
      setIsLoading(false);
      return;
    }

    try {
      const response = await api.get('/auth/me');
      setUser(response.data);
    } catch (error) {
      // Token might be invalid or expired
      removeStoredToken();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    try {
      const response = await api.post('/auth/login', { email, password });
      const userData = response.data;

      // Store the JWT token if provided
      if (userData.token) {
        setStoredToken(userData.token);
      }

      // Remove token from user object before storing in state
      const { token, ...userWithoutToken } = userData;
      setUser(userWithoutToken);
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED' || error.message?.includes('Network Error')) {
        throw new Error('Cannot connect to server. Please make sure the backend is running.');
      }
      throw error;
    }
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      // Ignore logout errors
    }
    removeStoredToken();
    localStorage.removeItem(ADMIN_TOKEN_BACKUP_KEY);
    setIsImpersonating(false);
    setUser(null);
  };

  // Admin: log in as a hotel (impersonation). Backs up the current admin token
  // so we can return afterwards.
  const impersonate = async (tenantId: string) => {
    const response = await api.post('/auth/impersonate', { tenantId });
    const userData = response.data;

    if (!userData.token) {
      throw new Error('Impersonation token alınamadı');
    }

    // Backup the admin token only the first time (avoid overwriting on nested calls)
    const currentToken = getStoredToken();
    if (currentToken && !localStorage.getItem(ADMIN_TOKEN_BACKUP_KEY)) {
      localStorage.setItem(ADMIN_TOKEN_BACKUP_KEY, currentToken);
    }

    setStoredToken(userData.token);
    const { token, impersonating, ...userWithoutToken } = userData;
    setUser(userWithoutToken);
    setIsImpersonating(true);
  };

  // Return to the admin account after impersonating
  const stopImpersonation = async () => {
    const adminToken = localStorage.getItem(ADMIN_TOKEN_BACKUP_KEY);
    if (adminToken) {
      setStoredToken(adminToken);
      localStorage.removeItem(ADMIN_TOKEN_BACKUP_KEY);
    }
    setIsImpersonating(false);

    try {
      const response = await api.get('/auth/me');
      setUser(response.data);
    } catch (error) {
      removeStoredToken();
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, login, logout, isLoading, isImpersonating, impersonate, stopImpersonation }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
