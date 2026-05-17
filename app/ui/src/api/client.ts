import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";

const BASE_URL = "/api/v1";

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// ─── Token helpers ────────────────────────────────────────────────────────────

function getAccessToken(): string | null {
  try {
    const state = localStorage.getItem("tamasha-auth");
    if (!state) return null;
    const parsed = JSON.parse(state) as { state?: { accessToken?: string } };
    return parsed?.state?.accessToken ?? null;
  } catch {
    return null;
  }
}

function getRefreshToken(): string | null {
  try {
    const state = localStorage.getItem("tamasha-auth");
    if (!state) return null;
    const parsed = JSON.parse(state) as { state?: { refreshToken?: string } };
    return parsed?.state?.refreshToken ?? null;
  } catch {
    return null;
  }
}

function setTokensInStorage(access: string, refresh: string) {
  try {
    const state = localStorage.getItem("tamasha-auth");
    const parsed = state ? (JSON.parse(state) as { state?: Record<string, unknown> }) : { state: {} };
    if (!parsed.state) parsed.state = {};
    parsed.state.accessToken = access;
    parsed.state.refreshToken = refresh;
    localStorage.setItem("tamasha-auth", JSON.stringify(parsed));
  } catch {
    // ignore
  }
}

function clearAuthStorage() {
  localStorage.removeItem("tamasha-auth");
}

// ─── Request interceptor: attach Authorization header ─────────────────────────

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─── Response interceptor: auto-refresh on 401 ───────────────────────────────

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token!);
    }
  });
  failedQueue = [];
}

interface RetryConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryConfig;

    if (error.response?.status === 401 && !originalRequest._retry) {
      // Login/refresh requests must fail naturally so callers can show errors
      if (originalRequest.url?.includes("/auth/login") || originalRequest.url?.includes("/auth/refresh")) {
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers!.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = getRefreshToken();

      if (!refreshToken) {
        clearAuthStorage();
        window.location.href = "/login";
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post<{
          access_token: string;
          refresh_token: string;
        }>("/api/v1/auth/refresh", { refresh_token: refreshToken });

        setTokensInStorage(data.access_token, data.refresh_token);
        processQueue(null, data.access_token);
        originalRequest.headers!.Authorization = `Bearer ${data.access_token}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        clearAuthStorage();
        window.location.href = "/login";
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);
