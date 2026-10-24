import type { DismantleResult, MakeBuildInput, MakeBuildResult } from '@ixfwms/domain';
import { api } from './client';
import { useChange } from './queries';

/** Makes a build from a parts list, moving the parts in from free stock. */
export const useMakeBuild = () =>
  useChange((input: MakeBuildInput) => api<MakeBuildResult>('/api/builds', { body: input }));

/** Takes a build apart: `to` null puts everything back where it came from. */
export const useDismantle = (code: string) =>
  useChange((to: string | null) =>
    api<DismantleResult>(`/api/locations/${code}/dismantle`, { body: { to } }),
  );
