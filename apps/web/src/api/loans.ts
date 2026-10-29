import type { LendInput, LoanView, ReturnPlaceInput, UnitDetail } from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useChange } from './queries';

/** Lending units and whole containers out of the lab, and getting them back. */
export const useLoans = () =>
  useQuery({ queryKey: ['loans'], queryFn: () => api<LoanView[]>('/api/loans?open=1') });

export const useLendUnit = (code: string) =>
  useChange((input: LendInput) => api<UnitDetail>(`/api/units/${code}/lend`, { body: input }));

export const useReturnUnit = (code: string) =>
  useChange((to: string | null) => api<UnitDetail>(`/api/units/${code}/return`, { body: { to } }));

export const useLendPlace = (code: string) =>
  useChange((input: LendInput) => api<LoanView>(`/api/locations/${code}/lend`, { body: input }));

export const useReturnPlace = (code: string) =>
  useChange((input: ReturnPlaceInput) =>
    api<LoanView>(`/api/locations/${code}/return`, { body: input }),
  );
