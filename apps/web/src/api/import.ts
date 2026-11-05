import type { ImportMapping } from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import { api, useChange } from './client';

/** Saved column mappings for importing items. */
export const useImportMappings = () =>
  useQuery({
    queryKey: ['importMappings'],
    queryFn: () => api<{ name: string; mapping: ImportMapping }[]>('/api/import/mappings'),
  });

export const useDeleteImportMapping = () =>
  useChange((name: string) =>
    api(`/api/import/mappings/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  );
