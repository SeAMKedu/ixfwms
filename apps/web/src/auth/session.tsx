import { hasScope, type LoginResult, type Scope, type SessionUser } from '@ixfwms/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, use, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { api, ApiError, getToken, setToken } from '../api/client';
import { setLanguage } from '../i18n';

interface Session {
  user: SessionUser | null;
  /** True while a stored token is being checked on startup. */
  checking: boolean;
  can: (scope: Scope) => boolean;
  login: (name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const me = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      if (!getToken()) return null;
      try {
        return await api<SessionUser>('/api/session');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setToken(null);
          return null;
        }
        throw err;
      }
    },
    staleTime: Infinity,
  });

  // A language saved on the account follows the person to every device.
  const language = me.data?.language;
  useEffect(() => {
    if (language) void setLanguage(language);
  }, [language]);

  const login = useCallback(
    async (name: string, password: string) => {
      const result = await api<LoginResult>('/api/session', { body: { name, password } });
      setToken(result.token);
      client.setQueryData(['session'], result.user);
    },
    [client],
  );

  const logout = useCallback(async () => {
    await api('/api/session', { method: 'DELETE' }).catch(() => {});
    setToken(null);
    client.setQueryData(['session'], null);
  }, [client]);

  const value = useMemo<Session>(() => {
    const user = me.data ?? null;
    return {
      user,
      checking: me.isPending,
      can: (scope) => (user ? hasScope(user.scopes, scope) : false),
      login,
      logout,
    };
  }, [me.data, me.isPending, login, logout]);

  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = use(SessionContext);
  if (!session) throw new Error('useSession outside SessionProvider');
  return session;
}
