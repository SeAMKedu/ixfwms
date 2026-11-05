import type { ClearResult, LotView, MoveAmount, UnitDetail } from '@ixfwms/domain';
import { api, useChange } from './client';

/** Moves people may make without an account, and the name they give. */
// --- units, problem reports (loans: ./loans) ---------------------------------------------------------

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
/** The guest's name for a change, or null when they gave none. */
export const guest = () => getGuestName() || null;

/** Moves and puts back work without an account too, as far as the lab allows. */
export const useMoveUnit = (code: string) =>
  useChange((to: string) =>
    api<UnitDetail>(`/api/units/${code}/move`, { body: { to, name: guest() } }),
  );

export const usePutBackUnit = (code: string) =>
  useChange(() => api<UnitDetail>(`/api/units/${code}/put-back`, { body: { name: guest() } }));

export const useOpenMoveLot = () =>
  useChange(({ lotId, ...body }: { lotId: string; to: string } & MoveAmount) =>
    api<LotView>(`/api/stock/${lotId}/open-move`, { body: { ...body, name: guest() } }),
  );

export const usePutBackLot = () =>
  useChange((lotId: string) =>
    api<LotView>(`/api/stock/${lotId}/put-back`, { body: { name: guest() } }),
  );

export const useClearBench = (code: string) =>
  useChange(() => api<ClearResult>(`/api/locations/${code}/clear`, { body: { name: guest() } }));
