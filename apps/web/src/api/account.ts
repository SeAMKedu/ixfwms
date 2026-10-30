import type { Scope, SessionUser, TokenInfo, UserLanguage } from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useChange } from './queries';

/** Your own account: default location, language and API tokens. */
export const useSaveSettings = () =>
  useChange((input: { home?: string | null; language?: UserLanguage | null }) =>
    api<Pick<SessionUser, 'home' | 'language'>>('/api/session', { method: 'PATCH', body: input }),
  );

export const useMyTokens = (enabled: boolean) =>
  useQuery({
    queryKey: ['session', 'tokens'],
    queryFn: () => api<TokenInfo[]>('/api/session/tokens'),
    enabled,
  });

export const useCreateMyToken = () =>
  useChange((input: { name: string; scopes: Scope[] }) =>
    api<{ token: string; id: string }>('/api/session/tokens', { body: input }),
  );

export const useRevokeMyToken = () =>
  useChange((id: string) => api(`/api/session/tokens/${id}`, { method: 'DELETE' }));
