import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User } from '../types';
import { apiClient, authFetch, apiFetch } from '../services/api';
import { useToast } from './ToastContext';
import { getAdminRoute } from '@/lib/env';
import { API_BASE_URL } from '@/lib/api'; // used by getGoogleLoginUrl

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  staffAccessDenied: boolean;
  login: (email: string, password?: string) => Promise<boolean>;
  logout: () => void;
  completeOAuthSession: (token: string, refreshToken: string) => Promise<boolean>;
  verifyStaffAccess: (eventId: string | null) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function userHasAdminDashboardAccess(eventId: string): Promise<boolean> {
  try {
    const res = await apiFetch<{ events: { id: string; scan_role: string }[] }>('/scan/events');
    const match = (res.events || []).find((e) => e.id === eventId);
    if (!match) return false;
    return match.scan_role === 'owner' || match.scan_role === 'admin';
  } catch {
    return false;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [staffAccessDenied, setStaffAccessDenied] = useState(false);
  const { error } = useToast();

  const loadUser = useCallback(async () => {
    const token = apiClient.getToken();
    if (!token) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    try {
      const res = await authFetch<{ user: User }>('/me');
      setUser(res.user);
    } catch {
      apiClient.clearSession();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const verifyStaffAccess = useCallback(async (eventId: string | null): Promise<boolean> => {
    if (!eventId || !user) {
      setStaffAccessDenied(false);
      return false;
    }
    const ok = await userHasAdminDashboardAccess(eventId);
    setStaffAccessDenied(!ok);
    return ok;
  }, [user]);

  const login = async (email: string, password?: string): Promise<boolean> => {
    setIsLoading(true);
    setStaffAccessDenied(false);
    try {
      const res = await authFetch<{ user: User; token: string; refresh_token?: string }>('/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      apiClient.setToken(res.token, res.refresh_token ?? null);
      setUser(res.user);
      return true;
    } catch (err: unknown) {
      error('Erreur de connexion', 'Identifiants incorrects.');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const completeOAuthSession = async (token: string, refreshToken: string): Promise<boolean> => {
    setIsLoading(true);
    setStaffAccessDenied(false);
    try {
      apiClient.setToken(token, refreshToken);
      const res = await authFetch<{ user: User }>('/me');
      setUser(res.user);
      return true;
    } catch {
      apiClient.clearSession();
      setUser(null);
      error('Connexion Google', 'Session invalide.');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await authFetch('/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    apiClient.clearSession();
    setUser(null);
    setStaffAccessDenied(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        staffAccessDenied,
        login,
        logout,
        completeOAuthSession,
        verifyStaffAccess,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export function getGoogleLoginUrl(): string {
  return `${API_BASE_URL}/auth/google?next=admin`;
}

export function getAdminLoginPath(): string {
  const route = getAdminRoute();
  return route ? `${route}/login` : '/';
}
