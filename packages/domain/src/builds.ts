import type { ClearResult, LocationSummary } from './api.js';

/** A build as a search result: where it sits, who to ask, and how many things are in it. */
export interface BuildBrief extends LocationSummary {
  description: string | null;
  contact: string | null;
  /** The place it sits in (null at the top level). */
  in: LocationSummary | null;
  /** Stock lots and units in it, places inside it included. */
  items: number;
}

/** What making a build moved into it, and what's left to put in by hand. */
export interface MakeBuildResult {
  build: LocationSummary;
  moved: { name: string; display: string; from: LocationSummary }[];
  left: {
    name: string;
    quantity: number;
    /** unknown: no such part; short: not enough free; byHand: levels or stock nobody has counted. */
    reason: 'unknown' | 'short' | 'byHand';
  }[];
}

/** What dismantling did. The build is marked dismantled once nothing is left in it. */
export interface DismantleResult extends ClearResult {
  dismantled: boolean;
}
