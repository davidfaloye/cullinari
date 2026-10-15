import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlanCode, Role, TenantStatus } from '@cullinari/shared';
import { api, getToken, setToken, setUnauthenticatedHandler } from './api';

export interface Me {
  user: { id: string; name: string; email: string; mustResetPassword: boolean };
  tenant: { id: string; name: string; slug: string; plan: PlanCode; status: TenantStatus; timezone: string; currency: string };
  role: Role;
  branchId: string | null;
  tenants: { id: string; name: string; slug: string; role: Role }[];
}

export interface Branch {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  hours: Record<string, { open: string; close: string } | null> | null;
  isActive: boolean;
}

interface AuthState {
  token: string | null;
  me: Me | undefined;
  loading: boolean;
  branches: Branch[];
  /** The branch the header switcher points at; null = all branches. */
  branchId: string | null;
  setBranchId: (id: string | null) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  switchTenant: (tenantId: string) => Promise<void>;
  can: (...roles: Role[]) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [token, setTok] = useState(getToken);
  const [branchId, setBranchId] = useState<string | null>(null);

  const logout = useCallback(() => {
    setToken(null);
    setTok(null);
    setBranchId(null);
    qc.clear();
  }, [qc]);

  useEffect(() => setUnauthenticatedHandler(logout), [logout]);

  const meQuery = useQuery({ queryKey: ['me', token], queryFn: () => api<Me>('/auth/me'), enabled: !!token, retry: false });
  const branchesQuery = useQuery({
    queryKey: ['branches', token],
    queryFn: () => api<Branch[]>('/branches'),
    enabled: !!token && !!meQuery.data,
  });

  const me = meQuery.data;
  // Staff tied to one branch are always on that branch.
  const effectiveBranch = me?.branchId ?? branchId;

  const value = useMemo<AuthState>(
    () => ({
      token,
      me,
      loading: !!token && meQuery.isLoading,
      branches: branchesQuery.data ?? [],
      branchId: effectiveBranch,
      setBranchId,
      login: async (email, password) => {
        const res = await api<{ token: string }>('/auth/login', { method: 'POST', body: { email, password } });
        setToken(res.token);
        qc.clear();
        setTok(res.token);
      },
      logout,
      switchTenant: async (tenantId) => {
        const res = await api<{ token: string }>('/auth/switch', { method: 'POST', body: { tenantId } });
        setToken(res.token);
        qc.clear();
        setBranchId(null);
        setTok(res.token);
      },
      can: (...roles) => !!me && roles.includes(me.role),
    }),
    [token, me, meQuery.isLoading, branchesQuery.data, effectiveBranch, logout, qc],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
