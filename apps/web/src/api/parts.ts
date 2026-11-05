import type {
  CreatePartRequest,
  PartDetail,
  PartSearchResult,
  PartStatus,
  SearchKind,
  UpdatePartInput,
} from '@ixfwms/domain';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs, useChange } from './client';

/** Items: searching, reading and changing them. */
export interface PartFilters {
  q?: string;
  status?: PartStatus;
  kind?: SearchKind;
  category?: string;
  /** Only items with all of these. */
  tag?: string[];
  location?: string;
  inStock?: boolean;
  lowStock?: boolean;
  uncounted?: boolean;
  /** false: one result per part instead of one per unit of a tool or device. */
  byUnit?: boolean;
  /** Category field filters as text, e.g. "thread:M4", "lengthMm>=10". */
  attr?: string[];
  limit?: number;
  offset?: number;
}

export const useParts = (filters: PartFilters) =>
  useQuery({
    queryKey: ['parts', filters],
    queryFn: ({ signal }) => api<PartSearchResult>(`/api/parts${qs({ ...filters })}`, { signal }),
    placeholderData: keepPreviousData,
  });

export const usePart = (code: string) =>
  useQuery({
    queryKey: ['part', code],
    queryFn: () => api<PartDetail>(`/api/parts/${code}`),
    enabled: code !== '',
  });

export const useTags = () =>
  useQuery({
    queryKey: ['tags'],
    queryFn: () => api<{ name: string; parts: number }[]>('/api/tags'),
  });

export const useCreatePart = () =>
  useChange((input: CreatePartRequest) => api<PartDetail>('/api/parts', { body: input }));
export const useUpdatePart = (code: string) =>
  useChange((input: UpdatePartInput) =>
    api<PartDetail>(`/api/parts/${code}`, { method: 'PATCH', body: input }),
  );
export const useSetStatus = (code: string) =>
  useChange((status: PartStatus) =>
    api<PartDetail>(`/api/parts/${code}/status`, { body: { status } }),
  );
export const useMergePart = (code: string) =>
  useChange((into: string) => api<PartDetail>(`/api/parts/${code}/merge`, { body: { into } }));
