import type { AttributeField, CategoryFields, CategoryInfo } from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import { api, qs, useChange } from './client';

/** Categories and the fields they define. */
export const useCategories = () =>
  useQuery({
    queryKey: ['categories'],
    queryFn: () => api<CategoryInfo[]>('/api/categories'),
  });

export const useCategoryFields = (path: string) =>
  useQuery({
    queryKey: ['categoryFields', path.toLowerCase()],
    queryFn: () => api<CategoryFields>(`/api/categories/fields${qs({ path })}`),
    enabled: path.trim() !== '',
  });

export const useSetCategoryFields = () =>
  useChange((input: { path: string; fields: AttributeField[] }) =>
    api<CategoryFields>('/api/categories/fields', { method: 'PUT', body: input }),
  );

export const useSeedCategories = () =>
  useChange(() => api<{ added: string[] }>('/api/categories/starter', { body: {} }));

export const useMoveCategory = () =>
  useChange((input: { path: string; to: string }) =>
    api<{ path: string }>('/api/categories/move', { body: input }),
  );

export const useDeleteCategory = () =>
  useChange((input: { path: string; moveTo: string | null }) =>
    api<{ moved: number }>(`/api/categories${qs({ path: input.path, moveTo: input.moveTo })}`, {
      method: 'DELETE',
    }),
  );
