import type { CarryState, CarrySummary, MoveAmount } from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import { api, useChange } from './client';

/** What you're carrying around the lab, and what everyone is. */
export const useCarry = (enabled: boolean) =>
  useQuery({ queryKey: ['carry'], queryFn: () => api<CarryState>('/api/carry'), enabled });

export const usePick = () =>
  useChange((input: { location?: string; lotId?: string; unit?: string } & MoveAmount) =>
    api<CarryState>('/api/carry/pick', { body: input }),
  );

export const useDrop = () =>
  useChange((input: { to: string; items?: string[] }) =>
    api<{ moved: number; state: CarryState }>('/api/carry/drop', { body: input }),
  );

export const useEveryoneCarrying = () =>
  useQuery({ queryKey: ['carry', 'all'], queryFn: () => api<CarrySummary[]>('/api/carry/all') });
