'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const TOKEN_KEY = 'payledger.token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Relative URL everywhere — the Next server proxies /api to the backend. */
export async function api<T = unknown>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body = init?.body;
  if (init?.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api/v1${path}`, { ...init, headers, body });
  if (res.status === 401 && typeof window !== 'undefined') {
    setToken(null);
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new ApiError(401, 'Session expired');
  }
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const env = parsed as { message?: string; details?: unknown } | null;
    throw new ApiError(
      res.status,
      env?.message ?? `Request failed (${res.status})`,
      env?.details,
    );
  }
  return parsed as T;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** SWR-lite hook: data + loading + error + manual refresh (+ optional poll). */
export function useApi<T>(path: string | null, opts?: { pollMs?: number; deps?: unknown[] }) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [error, setError] = useState<string | null>(null);
  const tick = useRef(0);
  const [nonce, setNonce] = useState(0);
  const extra = opts?.deps ?? [];

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (path === null) return;
    let alive = true;
    (async () => {
      try {
        const value = await api<T>(path);
        if (alive) {
          setData(value);
          setError(null);
        }
      } catch (err) {
        if (alive && !(err instanceof ApiError && err.status === 401)) {
          setError(err instanceof Error ? err.message : 'Request failed');
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...extra]);

  useEffect(() => {
    if (!opts?.pollMs || path === null) return;
    const id = window.setInterval(() => {
      tick.current++;
      setNonce((n) => n + 1);
    }, opts.pollMs);
    return () => window.clearInterval(id);
  }, [path, opts?.pollMs]);

  return { data, loading, error, refresh };
}
