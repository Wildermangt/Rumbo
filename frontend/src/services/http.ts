import axios, { AxiosError } from 'axios';
import type { ApiErrorBody, ApiErrorDetail } from '@/types/api';

export const TOKEN_STORAGE_KEY = 'tasks.auth.token';

/** Error normalizado que consume la UI (independiente de axios). */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

type UnauthorizedListener = () => void;
let onUnauthorized: UnauthorizedListener | null = null;

/** Permite al store de auth reaccionar a un 401 (token expirado/revocado). */
export function setUnauthorizedHandler(listener: UnauthorizedListener): void {
  onUnauthorized = listener;
}

http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (error instanceof AxiosError) {
      const body = error.response?.data as Partial<ApiErrorBody> | undefined;
      const status = error.response?.status ?? 0;
      const isLoginRequest = error.config?.url?.includes('/auth/login') ?? false;

      if (status === 401 && !isLoginRequest) onUnauthorized?.();

      if (body?.error) {
        return Promise.reject(new ApiError(body.error.message, status, body.error.code, body.error.details));
      }
      if (error.code === AxiosError.ECONNABORTED) {
        return Promise.reject(new ApiError('La solicitud tardó demasiado. Intente de nuevo.', 0, 'TIMEOUT'));
      }
      if (!error.response) {
        return Promise.reject(new ApiError('No se pudo conectar con el servidor.', 0, 'NETWORK_ERROR'));
      }
      return Promise.reject(new ApiError(`Error inesperado del servidor (${status}).`, status, 'UNKNOWN'));
    }
    return Promise.reject(error);
  },
);

/** Mensaje legible para cualquier error (incluye detalles de validación). */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.details.length > 0) {
      return `${error.message}: ${error.details.map((d) => d.message).join('; ')}`;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Ocurrió un error inesperado.';
}
