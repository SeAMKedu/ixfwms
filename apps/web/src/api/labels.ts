import type { CodeInfo, LabelBatch } from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import { api, useChange } from './client';

/** Codes and label sheets. */
export const lookupCode = (code: string) => api<CodeInfo>(`/api/codes/${encodeURIComponent(code)}`);

export const useCodeInfo = (code: string, enabled: boolean) =>
  useQuery({ queryKey: ['code', code], queryFn: () => lookupCode(code), enabled });

export const useLabelBatches = (enabled: boolean) =>
  useQuery({
    queryKey: ['labelBatches'],
    queryFn: () => api<LabelBatch[]>('/api/labels/batches'),
    enabled,
  });
export const useRetireCodes = () =>
  useChange((codes: string[]) =>
    api<{ retired: number }>('/api/labels/retire', { body: { codes } }),
  );
