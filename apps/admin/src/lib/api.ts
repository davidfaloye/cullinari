import type { ErrorCode } from '@cullinari/shared';

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
const TOKEN_KEY = 'cullinari.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: session lasts until reload */
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'INTERNAL' | 'NETWORK',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
  get isPlanLimit() {
    return this.code.startsWith('PLAN_LIMIT') || this.code === 'PLAN_FEATURE_LOCKED';
  }
}

let onUnauthenticated: () => void = () => {};
export function setUnauthenticatedHandler(fn: () => void) {
  onUnauthenticated = fn;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; query?: Record<string, string | number | undefined | null> } = {}): Promise<T> {
  const qs = init.query
    ? '?' +
      Object.entries(init.query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}${qs}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', "Can't reach Cullinari. Check your connection.");
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') onUnauthenticated();
    const message =
      json.code === 'VALIDATION' && Array.isArray(json.details) && json.details[0]?.message
        ? `${json.message}: ${json.details[0].message}`
        : (json.message ?? 'Something went wrong');
    throw new ApiError(res.status, json.code ?? 'INTERNAL', message, json.details);
  }
  return json as T;
}
