import type {
  AddStockInput,
  AmountInput,
  AttachInput,
  CarryState,
  CodeInfo,
  AttachmentView,
  CreateLocationInput,
  CreatePartInput,
  FileUpload,
  LocationDetail,
  LocationNode,
  LocationSummary,
  LotView,
  PartDetail,
  PartStatus,
  PartSummary,
  PlaceOption,
  SearchResult,
  ServerInfo,
  StockLevel,
  UpdateLocationInput,
  UpdatePartInput,
} from '@ixfwms/domain';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from './client';

export interface PartFilters {
  q?: string;
  status?: PartStatus;
  category?: string;
  tag?: string;
  location?: string;
  inStock?: boolean;
  limit?: number;
  offset?: number;
}

export const useInfo = () =>
  useQuery({ queryKey: ['info'], queryFn: () => api<ServerInfo>('/api/info') });

export const useParts = (filters: PartFilters) =>
  useQuery({
    queryKey: ['parts', filters],
    queryFn: ({ signal }) =>
      api<SearchResult<PartSummary>>(`/api/parts${qs({ ...filters })}`, { signal }),
    placeholderData: keepPreviousData,
  });

export const usePart = (code: string) =>
  useQuery({
    queryKey: ['part', code],
    queryFn: () => api<PartDetail>(`/api/parts/${code}`),
    enabled: code !== '',
  });

export const useLocation = (code: string, recursive: boolean) =>
  useQuery({
    queryKey: ['location', code, recursive],
    queryFn: () => api<LocationDetail>(`/api/locations/${code}${qs({ recursive })}`),
  });

export const useLocationTree = () =>
  useQuery({
    queryKey: ['locations', 'tree'],
    queryFn: () => api<LocationNode[]>('/api/locations?tree=1&depth=20'),
  });

export const usePlaces = () =>
  useQuery({
    queryKey: ['locations', 'flat'],
    queryFn: () => api<PlaceOption[]>('/api/locations?flat=1'),
    staleTime: 30_000,
  });

export const useCategories = () =>
  useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ path: string; parts: number }[]>('/api/categories'),
  });

export const useTags = () =>
  useQuery({
    queryKey: ['tags'],
    queryFn: () => api<{ name: string; parts: number }[]>('/api/tags'),
  });

/**
 * Every change can affect lists, counts and pages elsewhere; with a small inventory it is
 * simplest and always correct to refetch whatever is on screen.
 */
function useChange<I, O>(fn: (input: I) => Promise<O>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => client.invalidateQueries() });
}

export const useCreatePart = () =>
  useChange((input: CreatePartInput) => api<PartDetail>('/api/parts', { body: input }));
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

export const useAddStock = () =>
  useChange((input: AddStockInput) => api<LotView>('/api/stock', { body: input }));
export const useTakeStock = () =>
  useChange((i: { lotId: string; quantity?: number; level?: StockLevel }) =>
    api<LotView>(`/api/stock/${i.lotId}/take`, { body: { quantity: i.quantity, level: i.level } }),
  );
export const useStocktake = () =>
  useChange((i: { lotId: string; amount: AmountInput }) =>
    api<LotView>(`/api/stock/${i.lotId}/stocktake`, { body: i.amount }),
  );
export const useMoveStock = () =>
  useChange((i: { lotId: string; to: string; quantity?: number }) =>
    api<LotView>(`/api/stock/${i.lotId}/move`, { body: { to: i.to, quantity: i.quantity } }),
  );

export const useCreateLocation = () =>
  useChange((input: CreateLocationInput) =>
    api<LocationSummary>('/api/locations', { body: input }),
  );
export const useUpdateLocation = (code: string) =>
  useChange((input: UpdateLocationInput) =>
    api<LocationSummary>(`/api/locations/${code}`, { method: 'PATCH', body: input }),
  );
export const useMoveLocation = (code: string) =>
  useChange((parent: string | null) =>
    api<LocationSummary>(`/api/locations/${code}/move`, { body: { parent } }),
  );

export const useUpload = () =>
  useChange((file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api<FileUpload>('/api/files', { form });
  });
export const useAttach = () =>
  useChange((input: AttachInput) => api<AttachmentView>('/api/attachments', { body: input }));

export const lookupCode = (code: string) => api<CodeInfo>(`/api/codes/${encodeURIComponent(code)}`);

export const useCodeInfo = (code: string, enabled: boolean) =>
  useQuery({ queryKey: ['code', code], queryFn: () => lookupCode(code), enabled });

export const useCarry = (enabled: boolean) =>
  useQuery({ queryKey: ['carry'], queryFn: () => api<CarryState>('/api/carry'), enabled });

export const usePick = () =>
  useChange((input: { location?: string; lotId?: string; quantity?: number }) =>
    api<CarryState>('/api/carry/pick', { body: input }),
  );

export const useDrop = () =>
  useChange((input: { to: string; items?: string[] }) =>
    api<{ moved: number; state: CarryState }>('/api/carry/drop', { body: input }),
  );
