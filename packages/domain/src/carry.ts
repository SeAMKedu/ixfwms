import type { LocationSummary } from './locations.js';

/* What someone is carrying around the lab. */

export type CarriedItem =
  | {
      kind: 'lot';
      id: string;
      part: { code: string; name: string };
      display: string;
      since: string;
    }
  | { kind: 'location'; id: string; code: string; name: string; since: string }
  | { kind: 'unit'; id: string; code: string; name: string; since: string };

export interface CarryState {
  location: LocationSummary;
  items: CarriedItem[];
  /** When the oldest item was picked up; old ones are probably forgotten. */
  since: string | null;
}

/** Someone's carry list, for the "still being carried" reminder. */
export interface CarrySummary {
  /** Null for readers without a login. */
  user: string | null;
  location: LocationSummary;
  count: number;
  since: string;
}
