import { z } from 'zod';
import { MEASURE_UNITS, STOCK_MODES, isWeight, netOfReading } from './quantity.js';

/** A size in mm: [length] or [width, height]. */
export const PieceSchema = z.array(z.number().positive().max(1_000_000)).min(1).max(2);
const PiecesSchema = z.array(PieceSchema).max(1000);

export const AmountInput = z
  .object({
    mode: z.enum(STOCK_MODES).default('count'),
    quantity: z.number().nonnegative().nullish(),
    unit: z.enum(MEASURE_UNITS).nullish(),
    level: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .nullish()
      .describe("A stock level's key or name, e.g. plenty, low, empty (the lab's own list)"),
    tareG: z
      .number()
      .nonnegative()
      .nullish()
      .describe(
        'measure mode in g or kg: the quantity is a scale reading with containers on it that weigh this much; what is stored is the reading less this',
      ),
    full: z
      .number()
      .int()
      .positive()
      .nullish()
      .describe(
        "This many full containers (3 spools, 2 boxes): the item's container says how much a full one holds. Give nothing else with it.",
      ),
    pieces: PiecesSchema.nullish().describe(
      'cut mode: each piece in mm, [length] for bars or [width, height] for sheets',
    ),
    uncounted: z
      .boolean()
      .optional()
      .describe(
        'Not counted yet: the amount is unknown. Give no quantity or level (a unit still for measure).',
      ),
  })
  .superRefine((a, ctx) => {
    if (a.full != null) {
      if (a.quantity != null || a.level != null || a.pieces || a.uncounted || a.tareG != null)
        ctx.addIssue({ code: 'custom', message: 'full containers come with nothing else' });
      return;
    }
    if (a.tareG != null) {
      if (a.mode !== 'measure' || !isWeight(a.unit))
        ctx.addIssue({
          code: 'custom',
          message: 'a container weight goes with a weight in g or kg',
        });
      else if (a.quantity != null && netOfReading(a.quantity, a.unit!, a.tareG)! < 0)
        ctx.addIssue({ code: 'custom', message: 'the containers weigh more than the reading' });
    }
    if (a.mode === 'cut') {
      const n = a.pieces?.[0]?.length;
      if (a.uncounted || !a.pieces || a.pieces.some((p) => p.length !== n))
        ctx.addIssue({ code: 'custom', message: 'cut mode needs the pieces, all of one shape' });
      return;
    }
    if (a.uncounted) {
      if (a.quantity != null || a.level != null)
        ctx.addIssue({ code: 'custom', message: 'an uncounted amount has no quantity or level' });
      if (a.mode === 'measure' && a.unit == null)
        ctx.addIssue({ code: 'custom', message: 'measure mode needs a unit' });
      return;
    }
    if (a.mode === 'count' && a.quantity == null)
      ctx.addIssue({ code: 'custom', message: 'count mode needs a quantity' });
    if (a.mode === 'count' && a.quantity != null && !Number.isInteger(a.quantity))
      ctx.addIssue({ code: 'custom', message: 'a count is a whole number' });
    if (a.mode === 'measure' && (a.quantity == null || a.unit == null))
      ctx.addIssue({ code: 'custom', message: 'measure mode needs a quantity and a unit' });
    if (a.mode === 'level' && a.level == null)
      ctx.addIssue({ code: 'custom', message: 'level mode needs a level (plenty, low, empty)' });
  });
export type AmountInput = z.infer<typeof AmountInput>;

export const ContainerInput = z
  .object({
    name: z.string().trim().max(60).nullish().describe('What people call it: spool, reel, box'),
    massG: z.number().positive().nullish().describe('The empty container in grams'),
    holds: z.number().positive().nullish().describe('How much a full one holds, in unit'),
    unit: z
      .enum(MEASURE_UNITS)
      .nullish()
      .describe('Unit of holds; leave out for pieces (a box of 500 screws)'),
  })
  .transform((c) => ({
    name: c.name || null,
    massG: c.massG ?? null,
    holds: c.holds ?? null,
    unit: c.unit ?? null,
  }))
  .describe('What an item comes in: a filament spool, wire reel, box of screws');
export type ContainerInput = z.input<typeof ContainerInput>;
