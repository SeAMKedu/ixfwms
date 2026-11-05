import { z } from 'zod';
import type { ClearResult, LocationSummary } from './locations.js';
import { LEFTOVERS } from './cut.js';
import { PieceSchema } from './amount-input.js';
import { RefSchema } from './common.js';

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
    /** unknown: no such part; short: not enough free (or nothing big enough to cut it from). */
    reason: 'unknown' | 'short';
  }[];
}

/** What putting an item into a build did: moved from free stock, added new, or left to do. */
export interface AddToBuildResult extends Pick<MakeBuildResult, 'moved' | 'left'> {
  /** What was added as new stock (restAsNew), e.g. "3 pcs". */
  added: string | null;
}

/** What dismantling did. The build is marked dismantled once nothing is left in it. */
export interface DismantleResult extends ClearResult {
  dismantled: boolean;
}

/** A build made from a parts list: the parts are moved into it from free stock. */
export const MakeBuildInput = z.object({
  name: z.string().trim().min(1).max(200),
  parent: RefSchema.nullish().describe('Where the build sits (place id or code)'),
  type: z.string().trim().min(1).max(40).default('build').describe('A build type key'),
  contact: z.string().trim().max(200).nullish().describe('Who to ask about it'),
  description: z.string().trim().max(2000).nullish(),
  lines: z
    .array(
      z.object({
        part: RefSchema.describe('Part code or id'),
        quantity: z.number().int().positive().max(100_000),
        size: PieceSchema.nullish().describe('Cut stock: each piece cut to this size (mm)'),
      }),
    )
    .max(1000),
});
export type MakeBuildInput = z.input<typeof MakeBuildInput>;

/** One item into a build, from free stock. */
export const AddToBuildInput = z.object({
  part: RefSchema.describe('Part code or id'),
  quantity: z.number().int().positive().max(100_000).describe('Pieces (or units)'),
  size: PieceSchema.nullish().describe('Cut stock: cut each piece to this size (mm)'),
  leftover: z.enum(LEFTOVERS).nullish().describe('Sheets: which way the rest is kept'),
  from: RefSchema.nullish().describe(
    'Take from this stock lot (id) or unit (code); default the fullest free stock first',
  ),
  restAsNew: z
    .boolean()
    .default(false)
    .describe("Add what free stock can't cover as new stock in the build (bought new, say)"),
});
export type AddToBuildInput = z.input<typeof AddToBuildInput>;

export const DismantleInput = z.object({
  to: RefSchema.nullish().describe(
    'Put everything on this place (a workstation, say); omit to put everything back where it came from',
  ),
});
export type DismantleInput = z.infer<typeof DismantleInput>;
