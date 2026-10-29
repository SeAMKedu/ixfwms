import type {
  AddToBuildInput,
  AddToBuildResult,
  BuildBrief,
  DismantleResult,
  MakeBuildInput,
  MakeBuildResult,
  UnitDetail,
} from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { getGuestName, useChange } from './queries';

/** Makes a build from a parts list, moving the parts in from free stock. */
export const useMakeBuild = () =>
  useChange((input: MakeBuildInput) => api<MakeBuildResult>('/api/builds', { body: input }));

/** Takes a build apart: `to` null puts everything back where it came from. */
export const useDismantle = (code: string) =>
  useChange((to: string | null) =>
    api<DismantleResult>(`/api/locations/${code}/dismantle`, { body: { to } }),
  );

/** The Builds page: standing builds, or the dismantled ones. */
export const useBuilds = (dismantled: boolean) =>
  useQuery({
    queryKey: ['builds', dismantled],
    queryFn: () => api<BuildBrief[]>(`/api/builds${dismantled ? '?dismantled=1' : ''}`),
  });

/** Puts an existing item into a build, from free stock. */
export const useAddToBuild = (code: string) =>
  useChange((input: AddToBuildInput) =>
    api<AddToBuildResult>(`/api/builds/${code}/parts`, { body: input }),
  );

/** Deletes what was made by mistake: `/api/parts/X`, `/api/units/X` or `/api/locations/X`. */
export const useDelete = () => useChange((path: string) => api(path, { method: 'DELETE' }));

/** Archives an old container (`true`) or brings it back (`false`). */
export const archivePlace = (code: string, archive: boolean) =>
  api(`/api/locations/${code}/${archive ? 'archive' : 'unarchive'}`, { body: {} });

/** A lost unit turned up: at `to`, or back home. */
export const useFoundUnit = (code: string) =>
  useChange((to: string | null) =>
    api<UnitDetail>(`/api/units/${code}/found`, { body: { to, name: getGuestName() || null } }),
  );
