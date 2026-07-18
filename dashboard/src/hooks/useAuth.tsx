import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api';

type TenantRole = 'owner' | 'admin' | 'developer' | 'viewer';

interface Membership {
  tenantId: string;
  role: TenantRole;
  projectIds: string[];
}

interface AuthState {
  user: { id: string; email: string; emailVerified?: boolean } | null;
  memberships: Membership[];
  loading: boolean;
}

const AuthContext = createContext<AuthState & {
  roleFor(projectId: string): TenantRole | undefined;
  canManage(projectId: string): boolean;
  canAssign(projectId: string): boolean;
  canResolve(projectId: string): boolean;
  isViewer(projectId: string): boolean;
  refresh(): Promise<void>;
}>({
  user: null,
  memberships: [],
  loading: true,
  roleFor: () => undefined,
  canManage: () => false,
  canAssign: () => false,
  canResolve: () => false,
  isViewer: () => false,
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, memberships: [], loading: true });

  const fetchMe = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setState({ user: null, memberships: [], loading: false });
      return;
    }
    try {
      const user = await api.auth.me();
      setState({ user: { id: user.id, email: user.email, emailVerified: user.emailVerified }, memberships: user.memberships as Membership[], loading: false });
    } catch {
      setState({ user: null, memberships: [], loading: false });
    }
  }, []);

  useEffect(() => { void fetchMe(); }, [fetchMe]);

  // Silently re-issue the 15-minute access token while the app is open,
  // so active users aren't logged out mid-session.
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!localStorage.getItem('token')) return;
      try {
        const res = await api.auth.refresh();
        localStorage.setItem('token', res.token);
      } catch {
        // expired/revoked token — request() already redirects to /login on 401
      }
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const roleFor = useCallback((projectId: string): TenantRole | undefined => {
    for (const m of state.memberships) {
      if (m.projectIds.includes(projectId)) return m.role;
    }
    return undefined;
  }, [state.memberships]);

  const canManage = useCallback((projectId: string) => {
    const r = roleFor(projectId);
    return r === 'owner' || r === 'admin';
  }, [roleFor]);

  const canAssign = useCallback((projectId: string) => {
    const r = roleFor(projectId);
    return r === 'owner' || r === 'admin' || r === 'developer';
  }, [roleFor]);

  const canResolve = useCallback((projectId: string) => {
    const r = roleFor(projectId);
    return r === 'owner' || r === 'admin' || r === 'developer';
  }, [roleFor]);

  const isViewer = useCallback((projectId: string) => {
    return roleFor(projectId) === 'viewer';
  }, [roleFor]);

  return (
    <AuthContext.Provider value={{ ...state, roleFor, canManage, canAssign, canResolve, isViewer, refresh: fetchMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
