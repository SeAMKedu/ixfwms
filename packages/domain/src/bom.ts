import type { Piece } from './cut.js';
import { z } from 'zod';

/** One line of a parts list (BOM) from CAD, EPLAN, TIA Portal or a hand-written list. */
export const BomLine = z
  .object({
    /** A part code, order number or MPN. */
    ref: z.string().trim().max(200).nullish(),
    name: z.string().trim().max(300).nullish(),
    quantity: z.number().positive().default(1),
    /** Cut stock: the size of each piece, "400" or "300 x 200" (mm). */
    size: z.string().trim().max(60).nullish(),
  })
  .refine((l) => !!(l.ref || l.name), { message: 'Each line needs a code/order number or a name' });
export type BomLine = z.infer<typeof BomLine>;

export type BomStatus = 'ok' | 'short' | 'unknown' | 'missing';

export interface BomLineResult {
  line: number;
  ref: string | null;
  name: string | null;
  quantity: number;
  /** The size asked for, read for the part's cut shape; null for anything else. */
  size: Piece | null;
  /** How the part was found: by code/order number, by a similar name (check it), or not at all. */
  match: 'exact' | 'similar' | 'none';
  part: { code: string; name: string; manufacturer: string | null } | null;
  /** Other possible parts when the match is only by name. */
  candidates: { code: string; name: string; score: number }[];
  /** Free pieces we can count (weighed stock included when the piece mass is known), and
   *  usable units; what's built into something doesn't count. */
  available: number;
  /** Pieces built into builds, which could be had by taking them apart. */
  salvageable: number;
  /** Some stock is only tracked as a level ("plenty"/"low") or as a length without a piece count. */
  uncounted: boolean;
  status: BomStatus;
  /** Where the stock and units are; `build` is set for what's built into one. */
  where: {
    code: string;
    path: string;
    display: string;
    build: { code: string; name: string } | null;
  }[];
}

export interface BomCheck {
  lines: BomLineResult[];
  /** Complete sets we can build from counted stock; null when the list can't be judged from counts alone. */
  buildable: number | null;
  missing: number;
  short: number;
}
