import { z } from 'zod';
import { AmountInput, PieceSchema } from './amount-input.js';
import { RefSchema, ReporterName } from './common.js';
import { LEFTOVERS } from './cut.js';
import type { LocationSummary } from './locations.js';
import type { StockAmount } from './quantity.js';

/* Stock amounts: adding and moving lots. */

export const AddStockInput = z.object({
  part: RefSchema,
  location: RefSchema.nullish(),
  amount: AmountInput,
  note: z.string().trim().max(1000).nullish(),
});
export type AddStockInput = z.infer<typeof AddStockInput>;

/** Moving a unit or stock by someone who may not have an account. */
/** How much of a lot to move: all of it, an amount in its own unit, a count of pieces, or a cut. */
export const MoveAmount = z.object({
  quantity: z.number().positive().nullish().describe("In the lot's own unit"),
  pieces: z
    .number()
    .int()
    .positive()
    .nullish()
    .describe(
      'A count of pieces: from a level, stock nobody counted or a length, the lot stays as it is and the pieces arrive counted',
    ),
  cut: z
    .object({
      size: PieceSchema.describe('mm: [length] or [width, height]'),
      piece: z
        .number()
        .int()
        .min(0)
        .nullish()
        .describe("Which of the lot's pieces; default the smallest it fits in"),
      leftover: z.enum(LEFTOVERS).nullish().describe('Sheets: which way the rest is kept'),
    })
    .nullish()
    .describe('Cut a piece of this size off (bars and sheets)'),
});
export type MoveAmount = z.infer<typeof MoveAmount>;

export const OpenMoveInput = MoveAmount.extend({
  to: RefSchema,
  name: ReporterName,
});
export type OpenMoveInput = z.infer<typeof OpenMoveInput>;

export interface LotView {
  id: string;
  partId: string;
  amount: StockAmount;
  display: string;
  estimatedCount: number | null;
  note: string | null;
  lastCheckedAt: string | null;
  location: LocationSummary;
  path: LocationSummary[];
  /** Where it belongs back to, while it's at a workstation, a temporary place or being carried. */
  origin: { code: string; name: string } | null;
}
