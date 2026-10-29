import { z } from 'zod';
import { DateSchema, RefSchema } from './schemas.js';

/** Lending a unit, or a whole container with everything in it, out of the lab. */
export const LendInput = z.object({
  responsible: z
    .string()
    .trim()
    .max(80)
    .nullish()
    .describe('User name of the person responsible (has an account); defaults to you'),
  description: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe('What for and where, e.g. "thesis tests at Company X, for Pekka V."'),
  dueAt: DateSchema.nullish().describe('Expected back, YYYY-MM-DD'),
});
export type LendInput = z.infer<typeof LendInput>;

export const ReturnPlaceInput = z.object({
  to: RefSchema.nullish().describe('Where it goes; default where it was before it was lent'),
  missing: z
    .array(RefSchema)
    .max(500)
    .nullish()
    .describe('Codes of units inside that did not come back; they are marked lost'),
});
export type ReturnPlaceInput = z.infer<typeof ReturnPlaceInput>;
