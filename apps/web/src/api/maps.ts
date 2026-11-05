import type { MapCheck, MapDrawingInfo, MapKind, MapLayer } from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import { api, useChange } from './client';

/** Maps of places and the drawing library. */
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
