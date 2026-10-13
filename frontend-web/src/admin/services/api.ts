import { API_BASE_URL } from '@/lib/api';
import { logAdminApiDiagnostic } from '../lib/user-facing-api-error';

export const API_URL = API_BASE_URL;

const TOKEN_KEY = 'tdev_admin_token';
const REFRESH_KEY = 'tdev_admin_refresh_token';

class ApiClient {
  private token: string | null = null;
  private refreshToken: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  constructor() {
    this.token = localStorage.getItem(TOKEN_KEY);
    this.refreshToken = localStorage.getItem(REFRESH_KEY);
  }

  setToken(token: string | null, refreshToken?: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
    if (refreshToken !== undefined) {
      this.refreshToken = refreshToken;
      if (refreshToken) {
        localStorage.setItem(REFRESH_KEY, refreshToken);
      } else {
        localStorage.removeItem(REFRESH_KEY);
      }
    }
  }

  getToken(): string | null {
    return this.token;
  }

  clearSession() {
    this.setToken(null, null);
  }

  private async tryRefresh(): Promise<boolean> {
    if (!this.refreshToken) return false;
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      try {
        const url = `${API_URL}/auth/refresh`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.refreshToken}`,
          },
          credentials: 'omit',
        });
        if (!response.ok) return false;
        const body = await response.json();
        if (body.token) {
          this.setToken(body.token, body.refresh_token ?? this.refreshToken);
          return true;
        }
        return false;
      } catch (err) {
        logAdminApiDiagnostic('refresh', err);
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }

  async fetch<T>(endpoint: string, options: RequestInit = {}, retried = false): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${API_URL}${cleanEndpoint}`;

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers,
        credentials: 'omit',
      });
    } catch (err) {
      logAdminApiDiagnostic('network', err);
      throw new Error('network');
    }

    if (response.status === 401 && !retried && !cleanEndpoint.startsWith('/auth/')) {
      const refreshed = await this.tryRefresh();
      if (refreshed) {
        return this.fetch<T>(endpoint, options, true);
      }
      this.clearSession();
    }

    if (!response.ok) {
      try {
        await response.json();
      } catch {
        // corps absent ou non JSON — détail loggé côté diagnostic si besoin
      }
      logAdminApiDiagnostic('http', { status: response.status, endpoint: cleanEndpoint });
      if (response.status >= 500) {
        throw new Error('service_unavailable');
      }
      if (response.status === 403) {
        throw new Error('forbidden');
      }
      throw new Error('request_failed');
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  async download(endpoint: string, filename: string): Promise<void> {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    let response: Response;
    try {
      response = await fetch(`${API_URL}${cleanEndpoint}`, {
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : undefined,
      });
    } catch (err) {
      logAdminApiDiagnostic('download', err);
      throw new Error('network');
    }
    if (response.status === 404) {
      throw new Error('empty_export');
    }
    if (!response.ok) {
      throw new Error('download_failed');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}

export const apiClient = new ApiClient();

export const apiFetch = <T>(endpoint: string, options?: RequestInit) =>
  apiClient.fetch<T>(endpoint, options);

export const authFetch = <T>(endpoint: string, options?: RequestInit) =>
  apiClient.fetch<T>(`/auth${endpoint}`, options);
