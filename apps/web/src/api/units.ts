import type {
  AddUnitsInput,
  NetworkEntry,
  UnitAttention,
  UnitBrief,
  UnitDetail,
  UnitLogInput,
  UpdateUnitInput,
} from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import { api, useChange } from './client';

/** Units: individual things, their log and status. */
export const useUnit = (code: string) =>
  useQuery({
    queryKey: ['unit', code],
    queryFn: () => api<UnitDetail>(`/api/units/${code}`),
    enabled: code !== '',
  });

export const useAddUnits = () =>
  useChange((input: AddUnitsInput) => api<UnitBrief[]>('/api/units', { body: input }));

export const useUpdateUnit = (code: string) =>
  useChange((input: UpdateUnitInput) =>
    api<UnitDetail>(`/api/units/${code}`, { method: 'PATCH', body: input }),
  );

export const useUnitLog = (code: string) =>
  useChange((input: UnitLogInput) => api<UnitDetail>(`/api/units/${code}/log`, { body: input }));

export const useUnitAttention = () =>
  useQuery({
    queryKey: ['units', 'attention'],
    queryFn: () => api<UnitAttention[]>('/api/units/attention'),
  });

export const useNetwork = (enabled: boolean) =>
  useQuery({
    queryKey: ['network'],
    queryFn: () => api<NetworkEntry[]>('/api/network'),
    enabled,
  });
