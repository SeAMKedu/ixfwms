import type { LabSettings, ServerInfo, SystemInfo } from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import { api, useChange } from './client';

/** The server, the lab's settings, HTTPS setup and backups. */
export const useInfo = () =>
  useQuery({ queryKey: ['info'], queryFn: () => api<ServerInfo>('/api/info') });

export const useLabSettings = () =>
  useQuery({
    queryKey: ['settings'],
    queryFn: () => api<LabSettings>('/api/settings'),
    staleTime: 60_000,
  });

export const useUpdateSettings = () =>
  useChange((patch: Partial<LabSettings>) =>
    api<LabSettings>('/api/settings', { method: 'PATCH', body: patch }),
  );

export const useSystemInfo = (enabled: boolean) =>
  useQuery({ queryKey: ['system'], queryFn: () => api<SystemInfo>('/api/system'), enabled });

export const useSetup = () =>
  useQuery({
    queryKey: ['setup'],
    queryFn: () => api<{ secure: boolean; certificate: boolean; baseUrl: string }>('/api/setup'),
  });

export const useBackups = (enabled: boolean) =>
  useQuery({
    queryKey: ['backups'],
    queryFn: () => api<{ name: string; size: number }[]>('/api/backups'),
    enabled,
  });
export const useBackupNow = () =>
  useChange(() => api<{ file: string }>('/api/backups', { body: {} }));
