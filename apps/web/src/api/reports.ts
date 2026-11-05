import type { ReportInput, ReportView } from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import { api, useChange } from './client';
import { guest } from './open';

/** Problem reports. */
export const useReports = () =>
  useQuery({ queryKey: ['reports'], queryFn: () => api<ReportView[]>('/api/reports?open=1') });

export const useReport = () =>
  useChange((input: Omit<ReportInput, 'name'>) =>
    api<ReportView>('/api/reports', { body: { ...input, name: guest() } }),
  );

export const useResolveReport = () =>
  useChange((i: { id: string; resolution?: string | null }) =>
    api<ReportView>(`/api/reports/${i.id}/resolve`, { body: { resolution: i.resolution ?? null } }),
  );
