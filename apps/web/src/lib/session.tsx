'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api';

export type Role =
  | 'PLATFORM_ADMIN'
  | 'COMPANY_ADMIN'
  | 'HR_MANAGER'
  | 'ACCOUNTANT'
  | 'EMPLOYEE'
  | 'CONTRACTOR';

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
  role: Role;
  companyId: string | null;
  company?: { id: string; name: string } | null;
}

interface SessionCtx {
  user: SessionUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<SessionCtx>({
  user: null,
  ready: false,
  login: async () => {},
  logout: () => {},
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!getToken()) {
        if (alive) setReady(true);
        return;
      }
      try {
        const me = await api<SessionUser>('/auth/me');
        if (alive) setUser(me);
      } catch {
        setToken(null);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ accessToken: string; user: SessionUser }>('/auth/login', {
      method: 'POST',
      json: { email, password },
    });
    setToken(res.accessToken);
    setUser(res.user ?? null);
    if (!res.user) {
      const me = await api<SessionUser>('/auth/me');
      setUser(me);
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    window.location.href = '/login';
  }, []);

  const value = useMemo(() => ({ user, ready, login, logout }), [user, ready, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  return useContext(Ctx);
}
