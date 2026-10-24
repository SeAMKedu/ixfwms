import type {
  AddStockInput,
  AddUnitsInput,
  ClearResult,
  LendInput,
  LoanView,
  NetworkEntry,
  ReportInput,
  ReportView,
  UnitAttention,
  UnitBrief,
  UnitDetail,
  UnitLogInput,
  UpdateUnitInput,
  AmountInput,
  AttachInput,
  AttributeField,
  CategoryFields,
  CategoryInfo,
  CarryState,
  CarrySummary,
  HistoryEntry,
  Scope,
  UserDetail,
  UserInfo,
  UserRole,
  CodeInfo,
  LabelBatch,
  AttachmentView,
  CreateLocationInput,
  CreatePartRequest,
  FileUpload,
  LocationDetail,
  LocationNode,
  LocationSummary,
  LocationTypeInfo,
  LocationTypeInput,
  LabSettings,
  ImportMapping,
  OverduePlace,
  SystemInfo,
  DuplicateLocationInput,
  LotView,
  MapCheck,
  MapDrawingInfo,
  MapKind,
  MapLayer,
  PartDetail,
  PartKind,
  PartStatus,
  PlaceOption,
  PartSearchResult,
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
  kind?: PartKind;
  category?: string;
  tag?: string;
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

export const useInfo = () =>
  useQuery({ queryKey: ['info'], queryFn: () => api<ServerInfo>('/api/info') });

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
  useChange((input: { location?: string; lotId?: string; unit?: string; quantity?: number }) =>
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

export const useAttachMap = (code: string) =>
  useChange((input: { drawingId: string; copyFrom?: string | null }) =>
    api<MapCheck>(`/api/locations/${code}/map/attach`, { body: input }),
  );

export const useSetMapLink = (code: string) =>
  useChange((input: { kind: MapKind; elementKey: string; target: string | null }) =>
    api<MapCheck>(`/api/locations/${code}/map/links`, { method: 'PUT', body: input }),
  );

export const useCopyMapLinks = (code: string) =>
  useChange((input: { kind: MapKind; from: string }) =>
    api<MapCheck>(`/api/locations/${code}/map/copy-links`, { body: input }),
  );

export const useMapDrawings = (enabled = true) =>
  useQuery({
    queryKey: ['mapDrawings'],
    queryFn: () => api<MapDrawingInfo[]>('/api/map-drawings'),
    enabled,
  });

export const useCreateDrawing = () =>
  useChange((input: { fileId: string; name?: string | null }) =>
    api<MapDrawingInfo>('/api/map-drawings', { body: input }),
  );

export const useReplaceDrawing = () =>
  useChange((input: { id: string; fileId: string }) =>
    api<{ location: string; check: MapCheck }[]>(`/api/map-drawings/${input.id}`, {
      method: 'PUT',
      body: { fileId: input.fileId },
    }),
  );

export const useRenameDrawing = () =>
  useChange((input: { id: string; name: string }) =>
    api(`/api/map-drawings/${input.id}`, { method: 'PATCH', body: { name: input.name } }),
  );

export const useDeleteDrawing = () =>
  useChange((id: string) => api(`/api/map-drawings/${id}`, { method: 'DELETE' }));

export const useLocationTypes = () =>
  useQuery({
    queryKey: ['locationTypes'],
    queryFn: () => api<LocationTypeInfo[]>('/api/location-types'),
    staleTime: 60_000,
  });

export const useCreateLocationType = () =>
  useChange((input: LocationTypeInput) =>
    api<LocationTypeInfo>('/api/location-types', { body: input }),
  );

export const useUpdateLocationType = () =>
  useChange(({ key, ...input }: Partial<LocationTypeInput> & { key: string }) =>
    api<LocationTypeInfo>(`/api/location-types/${key}`, { method: 'PATCH', body: input }),
  );

export const useDeleteLocationType = () =>
  useChange((key: string) => api(`/api/location-types/${key}`, { method: 'DELETE' }));

export const useLabSettings = () =>
  useQuery({
    queryKey: ['settings'],
    queryFn: () => api<LabSettings>('/api/settings'),
    staleTime: 60_000,
  });

export const useUpdateSettings = () =>
  useChange((patch: Partial<LabSettings>) =>
    api<LabSettings>('/api/settings', { method: 'PATCH', body: patch }),
  );

export const useSystemInfo = (enabled: boolean) =>
  useQuery({ queryKey: ['system'], queryFn: () => api<SystemInfo>('/api/system'), enabled });

export const useOverdue = () =>
  useQuery({
    queryKey: ['overdue'],
    queryFn: () => api<OverduePlace[]>('/api/locations/overdue'),
  });

export const useStillNeeded = (code: string) =>
  useChange(() => api<LocationSummary>(`/api/locations/${code}/still-needed`, { body: {} }));

export const useImportMappings = () =>
  useQuery({
    queryKey: ['importMappings'],
    queryFn: () => api<{ name: string; mapping: ImportMapping }[]>('/api/import/mappings'),
  });

export const useDeleteImportMapping = () =>
  useChange((name: string) =>
    api(`/api/import/mappings/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  );

export const useDuplicateLocation = (code: string) =>
  useChange((input: DuplicateLocationInput) =>
    api<LocationSummary[]>(`/api/locations/${code}/duplicate`, { body: input }),
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
export const useUser = (name: string, enabled: boolean) =>
  useQuery({
    queryKey: ['users', name],
    queryFn: () => api<UserDetail>(`/api/users/${encodeURIComponent(name)}`),
    enabled,
  });
export const useDeactivateUser = () =>
  useChange((name: string) =>
    api(`/api/users/${encodeURIComponent(name)}/deactivate`, { body: {} }),
  );
export const useReactivateUser = () =>
  useChange((name: string) =>
    api(`/api/users/${encodeURIComponent(name)}/reactivate`, { body: {} }),
  );
export const useDeleteUser = () =>
  useChange((name: string) => api(`/api/users/${encodeURIComponent(name)}`, { method: 'DELETE' }));
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

// --- units, loans, problem reports ---------------------------------------------------------

/** The name someone without an account gives, remembered on this device. */
const GUEST_KEY = 'ixfwms.guestName';
export function getGuestName(): string {
  try {
    return localStorage.getItem(GUEST_KEY) ?? '';
  } catch {
    return '';
  }
}
export function setGuestName(name: string): void {
  try {
    if (name.trim()) localStorage.setItem(GUEST_KEY, name.trim());
    else localStorage.removeItem(GUEST_KEY);
  } catch {
    // remembered for this visit only
  }
}
const guest = () => getGuestName() || null;

export const useUnit = (code: string) =>
  useQuery({
    queryKey: ['unit', code],
    queryFn: () => api<UnitDetail>(`/api/units/${code}`),
    enabled: code !== '',
  });

export const useAddUnits = () =>
  useChange((input: AddUnitsInput) => api<UnitBrief[]>('/api/units', { body: input }));

export const useUpdateUnit = (code: string) =>
  useChange((input: UpdateUnitInput) =>
    api<UnitDetail>(`/api/units/${code}`, { method: 'PATCH', body: input }),
  );

export const useUnitLog = (code: string) =>
  useChange((input: UnitLogInput) => api<UnitDetail>(`/api/units/${code}/log`, { body: input }));

/** Moves and puts back work without an account too, as far as the lab allows. */
export const useMoveUnit = (code: string) =>
  useChange((to: string) =>
    api<UnitDetail>(`/api/units/${code}/move`, { body: { to, name: guest() } }),
  );

export const usePutBackUnit = (code: string) =>
  useChange(() => api<UnitDetail>(`/api/units/${code}/put-back`, { body: { name: guest() } }));

export const useLendUnit = (code: string) =>
  useChange((input: LendInput) => api<UnitDetail>(`/api/units/${code}/lend`, { body: input }));

export const useReturnUnit = (code: string) =>
  useChange((to: string | null) => api<UnitDetail>(`/api/units/${code}/return`, { body: { to } }));

export const useOpenMoveLot = () =>
  useChange((i: { lotId: string; to: string; quantity?: number }) =>
    api<LotView>(`/api/stock/${i.lotId}/open-move`, {
      body: { to: i.to, quantity: i.quantity, name: guest() },
    }),
  );

export const usePutBackLot = () =>
  useChange((lotId: string) =>
    api<LotView>(`/api/stock/${lotId}/put-back`, { body: { name: guest() } }),
  );

export const useClearBench = (code: string) =>
  useChange(() => api<ClearResult>(`/api/locations/${code}/clear`, { body: { name: guest() } }));

export const useLoans = () =>
  useQuery({ queryKey: ['loans'], queryFn: () => api<LoanView[]>('/api/loans?open=1') });

export const useUnitAttention = () =>
  useQuery({
    queryKey: ['units', 'attention'],
    queryFn: () => api<UnitAttention[]>('/api/units/attention'),
  });

export const useNetwork = (enabled: boolean) =>
  useQuery({
    queryKey: ['network'],
    queryFn: () => api<NetworkEntry[]>('/api/network'),
    enabled,
  });

export const useReports = () =>
  useQuery({ queryKey: ['reports'], queryFn: () => api<ReportView[]>('/api/reports?open=1') });

export const useReport = () =>
  useChange((input: Omit<ReportInput, 'name'>) =>
    api<ReportView>('/api/reports', { body: { ...input, name: guest() } }),
  );

export const useResolveReport = () =>
  useChange((i: { id: string; resolution?: string | null }) =>
    api<ReportView>(`/api/reports/${i.id}/resolve`, { body: { resolution: i.resolution ?? null } }),
  );
