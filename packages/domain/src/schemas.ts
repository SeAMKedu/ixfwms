import { z } from 'zod';
import { IDENTIFIER_KINDS } from './identifiers.js';
import { MEASURE_UNITS, STOCK_LEVELS, STOCK_MODES } from './quantity.js';
import { ATTACHMENT_KINDS, PART_STATUSES } from './enums.js';
import { AttributeFilter } from './attributes.js';

/** A location or part reference: internal id or short code. */
export const RefSchema = z.string().trim().min(1).max(64);

export const CreateLocationInput = z.object({
  name: z.string().trim().min(1).max(200),
  parent: RefSchema.nullish().describe('Parent location id or code; omit for a top-level location'),
  type: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .default('box')
    .describe('Location type key, e.g. room, cabinet, shelf, box'),
  description: z.string().trim().max(2000).nullish(),
  code: z
    .string()
    .trim()
    .max(16)
    .nullish()
    .describe('Use this code (e.g. from a pre-printed blank label) instead of a new one'),
});
export type CreateLocationInput = z.infer<typeof CreateLocationInput>;

export const UpdateLocationInput = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  type: z.string().trim().min(1).max(40).optional(),
  description: z.string().trim().max(2000).nullish(),
});
export type UpdateLocationInput = z.infer<typeof UpdateLocationInput>;

export const IdentifierInput = z.object({
  kind: z.enum(IDENTIFIER_KINDS).default('order_no'),
  value: z.string().trim().min(1).max(200),
  source: z.string().trim().max(200).nullish(),
});
export type IdentifierInput = z.infer<typeof IdentifierInput>;

export const AmountInput = z
  .object({
    mode: z.enum(STOCK_MODES).default('count'),
    quantity: z.number().nonnegative().nullish(),
    unit: z.enum(MEASURE_UNITS).nullish(),
    level: z.enum(STOCK_LEVELS).nullish(),
    tareG: z.number().nonnegative().nullish(),
  })
  .superRefine((a, ctx) => {
    if (a.mode === 'count' && a.quantity == null)
      ctx.addIssue({ code: 'custom', message: 'count mode needs a quantity' });
    if (a.mode === 'measure' && (a.quantity == null || a.unit == null))
      ctx.addIssue({ code: 'custom', message: 'measure mode needs a quantity and a unit' });
    if (a.mode === 'level' && a.level == null)
      ctx.addIssue({ code: 'custom', message: 'level mode needs a level (plenty, low, empty)' });
  });
export type AmountInput = z.infer<typeof AmountInput>;

export const CreatePartInput = z.object({
  name: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).nullish(),
  category: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .describe('Category path like "Pneumatics/Vacuum/Suction cups"; created if missing'),
  manufacturer: z.string().trim().max(200).nullish(),
  identifiers: z.array(IdentifierInput).max(20).default([]),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  unitMassG: z
    .number()
    .positive()
    .nullish()
    .describe('Mass of one piece in grams, lets weighed stock show an estimated count'),
  minStock: z.number().nonnegative().nullish(),
  attributes: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().trim().max(5000).nullish(),
  source: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .describe(
      'Where this entry came from, e.g. "order 4711 (Festo, 2026-10-14)" or "photo IMG_0042"',
    ),
  status: z.enum(PART_STATUSES).default('draft'),
  stock: z
    .object({ location: RefSchema.nullish(), amount: AmountInput })
    .nullish()
    .describe('Initial stock; location defaults to the Inbox'),
});
export type CreatePartInput = z.infer<typeof CreatePartInput>;

export const UpdatePartInput = CreatePartInput.omit({
  stock: true,
  identifiers: true,
  tags: true,
  status: true,
})
  .partial()
  .extend({
    addIdentifiers: z.array(IdentifierInput).max(20).optional(),
    removeIdentifiers: z
      .array(z.string().trim().min(1).max(200))
      .max(20)
      .optional()
      .describe('Identifier values to remove'),
    addTags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    removeTags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  });
export type UpdatePartInput = z.infer<typeof UpdatePartInput>;

export const PartSearchInput = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(300).optional(),
  tag: z.string().trim().max(60).optional(),
  status: z.enum(PART_STATUSES).optional(),
  location: RefSchema.optional().describe('Only parts stored in this location or below it'),
  inStock: z.boolean().optional(),
  lowStock: z.boolean().optional().describe('Below minimum stock, or marked low/empty'),
  attributes: z
    .array(AttributeFilter)
    .max(10)
    .optional()
    .describe('Filters on category fields, e.g. thread = M4, lengthMm >= 10'),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
export type PartSearchInput = z.infer<typeof PartSearchInput>;

export const AddStockInput = z.object({
  part: RefSchema,
  location: RefSchema.nullish(),
  amount: AmountInput,
  note: z.string().trim().max(1000).nullish(),
});
export type AddStockInput = z.infer<typeof AddStockInput>;

export const AttachInput = z
  .object({
    owner: z.enum(['part', 'location']),
    ref: RefSchema,
    kind: z.enum(ATTACHMENT_KINDS).default('other'),
    fileId: z.string().trim().min(1).max(64).nullish(),
    url: z.url().max(2000).nullish(),
    title: z.string().trim().max(300).nullish(),
  })
  .refine((a) => (a.fileId == null) !== (a.url == null), { message: 'give either fileId or url' });
export type AttachInput = z.infer<typeof AttachInput>;
