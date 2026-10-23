import type {
  AddStockInput,
  AmountInput,
  AttachInput,
  AttributeField,
  CategoryFields,
  CategoryInfo,
  CarryState,
  CarrySummary,
  HistoryEntry,
  Scope,
  UserInfo,
  UserRole,
  CodeInfo,
  AttachmentView,
  CreateLocationInput,
  CreatePartInput,
  FileUpload,
  LocationDetail,
  LocationNode,
  LocationSummary,
  LotView,
  MapCheck,
  MapKind,
  MapLayer,
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
  lowStock?: boolean;
  /** Category field filters as text, e.g. "thread:M4", "lengthMm>=10". */
  attr?: string[];
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
    queryFn: () => api<CategoryInfo[]>('/api/categories'),
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

export const useMapLayers = (code: string) =>
  useQuery({
    queryKey: ['maps', code],
    queryFn: () => api<MapLayer[]>(`/api/maps/${code}`),
    enabled: code !== '',
  });

export const useMapCheck = (code: string, kind: MapKind, enabled: boolean) =>
  useQuery({
    queryKey: ['mapCheck', code, kind],
    queryFn: () => api<MapCheck>(`/api/locations/${code}/map/check?kind=${kind}`),
    enabled,
  });

export const useSetMap = (code: string) =>
  useChange((fileId: string) =>
    api<MapCheck>(`/api/locations/${code}/map`, { method: 'PUT', body: { fileId } }),
  );

export const useRemoveMap = (code: string) =>
  useChange((kind: MapKind) =>
    api(`/api/locations/${code}/map?kind=${kind}`, { method: 'DELETE' }),
  );

export const useUsers = (enabled: boolean) =>
  useQuery({ queryKey: ['users'], queryFn: () => api<UserInfo[]>('/api/users'), enabled });
export const useCreateUser = () =>
  useChange((input: { name: string; role: UserRole; password?: string }) =>
    api('/api/users', { body: input }),
  );
export const useUpdateUser = () =>
  useChange((input: { name: string; role?: UserRole; password?: string }) =>
    api(`/api/users/${encodeURIComponent(input.name)}`, {
      method: 'PATCH',
      body: { role: input.role, password: input.password },
    }),
  );
export const useCreateToken = () =>
  useChange((input: { user: string; name: string; scopes: Scope[] }) =>
    api<{ token: string; id: string }>(`/api/users/${encodeURIComponent(input.user)}/tokens`, {
      body: { name: input.name, scopes: input.scopes },
    }),
  );
export const useRevokeToken = () =>
  useChange((id: string) => api(`/api/tokens/${id}`, { method: 'DELETE' }));
export const useChangePassword = () =>
  useChange((input: { current: string; next: string }) =>
    api('/api/session/password', { body: input }),
  );

export const useEveryoneCarrying = () =>
  useQuery({ queryKey: ['carry', 'all'], queryFn: () => api<CarrySummary[]>('/api/carry/all') });

export const useHistory = () =>
  useQuery({ queryKey: ['history'], queryFn: () => api<HistoryEntry[]>('/api/history?limit=150') });
export const useUndo = () =>
  useChange((input: { kind: 'stock' | 'location'; id: string }) =>
    api('/api/history/undo', { body: input }),
  );

export const useSetup = () =>
  useQuery({
    queryKey: ['setup'],
    queryFn: () => api<{ secure: boolean; certificate: boolean; baseUrl: string }>('/api/setup'),
  });

export const useBackups = (enabled: boolean) =>
  useQuery({
    queryKey: ['backups'],
    queryFn: () => api<{ name: string; size: number }[]>('/api/backups'),
    enabled,
  });
export const useBackupNow = () =>
  useChange(() => api<{ file: string }>('/api/backups', { body: {} }));
