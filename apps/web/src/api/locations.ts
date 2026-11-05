import type {
  CreateLocationInput,
  DuplicateLocationInput,
  LocationDetail,
  LocationNode,
  LocationSummary,
  LocationTypeInfo,
  LocationTypeInput,
  OverduePlace,
  PlaceOption,
  UpdateLocationInput,
} from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import { api, qs, useChange } from './client';

/** Places and place types. */
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

export const useOverdue = () =>
  useQuery({
    queryKey: ['overdue'],
    queryFn: () => api<OverduePlace[]>('/api/locations/overdue'),
  });

export const useStillNeeded = (code: string) =>
  useChange(() => api<LocationSummary>(`/api/locations/${code}/still-needed`, { body: {} }));

export const useDuplicateLocation = (code: string) =>
  useChange((input: DuplicateLocationInput) =>
    api<LocationSummary[]>(`/api/locations/${code}/duplicate`, { body: input }),
  );

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
