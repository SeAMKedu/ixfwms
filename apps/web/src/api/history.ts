import type { HistoryEntry } from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import { api, useChange } from './client';

/** What changed, and undoing it. */
export const useHistory = () =>
  useQuery({ queryKey: ['history'], queryFn: () => api<HistoryEntry[]>('/api/history?limit=150') });
export const useUndo = () =>
  useChange((input: { kind: 'stock' | 'location'; id: string }) =>
    api('/api/history/undo', { body: input }),
  );
