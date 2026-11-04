import type { WhereIsAnswer } from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from './client';

/** "Where is …?": one answer per thing found, with the way there from the top down. */
export const useWhere = (q: string) =>
  useQuery({
    queryKey: ['where', q],
    queryFn: () => api<WhereIsAnswer[]>(`/api/where${qs({ q })}`),
    enabled: q !== '',
  });
