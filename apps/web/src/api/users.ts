import type { Scope, UserDetail, UserInfo, UserRole, UserSettingsInput } from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import { api, useChange } from './client';

/** People and their API tokens, for admins. */
export const useUsers = (enabled: boolean) =>
  useQuery({ queryKey: ['users'], queryFn: () => api<UserInfo[]>('/api/users'), enabled });
export const useCreateUser = () =>
  useChange((input: { name: string; role: UserRole; password?: string }) =>
    api('/api/users', { body: input }),
  );
export const useUpdateUser = () =>
  useChange(
    ({ name, ...body }: { name: string; role?: UserRole; password?: string } & UserSettingsInput) =>
      api(`/api/users/${encodeURIComponent(name)}`, { method: 'PATCH', body }),
  );
export const useUser = (name: string, enabled: boolean) =>
  useQuery({
    queryKey: ['users', name],
    queryFn: () => api<UserDetail>(`/api/users/${encodeURIComponent(name)}`),
    enabled,
  });
const userUrl = (name: string, action = '') => `/api/users/${encodeURIComponent(name)}${action}`;
export const useDeactivateUser = () =>
  useChange((name: string) => api(userUrl(name, '/deactivate'), { body: {} }));
export const useReactivateUser = () =>
  useChange((name: string) => api(userUrl(name, '/reactivate'), { body: {} }));
export const useDeleteUser = () =>
  useChange((name: string) => api(userUrl(name), { method: 'DELETE' }));
export const useEraseUser = () =>
  useChange((name: string) => api(userUrl(name, '/erase'), { body: {} }));
export const useCreateToken = () =>
  useChange((input: { user: string; name: string; scopes: Scope[] }) =>
    api<{ token: string; id: string }>(`/api/users/${encodeURIComponent(input.user)}/tokens`, {
      body: { name: input.name, scopes: input.scopes },
    }),
  );
export const useRevokeToken = () =>
  useChange((id: string) => api(`/api/tokens/${id}`, { method: 'DELETE' }));
