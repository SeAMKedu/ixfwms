import { z } from 'zod';
import { IDENTIFIER_KINDS } from './identifiers.js';
import { DEFAULT_STOCK_LEVELS, LEVEL_STATES, MEASURE_UNITS, STOCK_MODES } from './quantity.js';
import {
  ANONYMOUS_ACTIONS,
  ATTACHMENT_KINDS,
  PART_KINDS,
  PART_STATUSES,
  REPORT_KINDS,
  SEARCH_KINDS,
  TRACKING_MODES,
  UNIT_LOG_KINDS,
  UNIT_STATUSES,
} from './enums.js';
import { AttributeFilter } from './attributes.js';
import { CUT_SHAPES, LEFTOVERS } from './cut.js';
import { SHORT_NAME_PATTERN } from './addresses.js';

/** A location or part reference: internal id or short code. */
export const RefSchema = z.string().trim().min(1).max(64);

/** A size in mm: [length] or [width, height]. */
export const PieceSchema = z.array(z.number().positive().max(1_000_000)).min(1).max(2);
const PiecesSchema = z.array(PieceSchema).max(1000);

/** A place's short name for its address, e.g. "A" for Cabinet A; empty means guess it from the name. */
export const ShortNameSchema = z
  .string()
  .trim()
  .max(12)
  .refine((s) => s === '' || SHORT_NAME_PATTERN.test(s), {
    message: 'Use letters, digits, "." or "_" (no spaces or "-")',
  })
  .transform((s) => s || null)
  .nullish()
  .describe('Short name used in the address, e.g. "A" for Cabinet A or "A140.1" for a room');

/** Expected stay of a temporary place in days: null = as its type says, 0 = not temporary. */
export const StayDaysSchema = z
  .number()
  .int()
  .min(0)
  .max(3650)
  .nullish()
  .describe('Temporary place: expected stay in days; 0 = not temporary, null = as its type says');

export const CreateLocationInput = z.object({
  name: z.string().trim().min(1).max(200),
  shortName: ShortNameSchema,
  stayDays: StayDaysSchema,
  contact: z.string().trim().max(200).nullish().describe('Who to ask about a temporary place'),
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

export const DuplicateLocationInput = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .nullish()
    .describe(
      'Name of the (first) copy; by default the next free name, e.g. Cabinet A → Cabinet B',
    ),
  parent: RefSchema.nullish().describe(
    'Where the copies go; omit to put them next to the original, null for the top level',
  ),
  count: z.number().int().min(1).max(20).default(1),
  maps: z.boolean().default(true).describe('Use the same maps, with shapes linked to the copies'),
});
export type DuplicateLocationInput = z.input<typeof DuplicateLocationInput>;

export const UpdateLocationInput = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  shortName: ShortNameSchema,
  stayDays: StayDaysSchema,
  contact: z.string().trim().max(200).nullish(),
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
    level: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .nullish()
      .describe("A stock level's key or name, e.g. plenty, low, empty (the lab's own list)"),
    tareG: z.number().nonnegative().nullish(),
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
  kind: z.enum(PART_KINDS).default('part').describe('part (stock), tool, or device/machine'),
  tracking: z
    .enum(TRACKING_MODES)
    .default('bulk')
    .describe('bulk = amounts per place; individual = units, each with its own code and serial'),
  aliases: z
    .array(z.string().trim().min(1).max(100))
    .max(20)
    .default([])
    .describe('Other names people use, e.g. "impact driver", "iskuporakone"'),
  identifiers: z.array(IdentifierInput).max(20).default([]),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  unitMassG: z
    .number()
    .positive()
    .nullish()
    .describe('Mass of one piece in grams, lets weighed stock show an estimated count'),
  minStock: z.number().nonnegative().nullish(),
  cut: z
    .enum(CUT_SHAPES)
    .nullish()
    .describe('Cut stock: by length (profiles, rod, tube) or as sheets; pieces keep their sizes'),
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
/** What a client sends: fields with defaults (kind, tracking, aliases…) may be left out. */
export type CreatePartRequest = z.input<typeof CreatePartInput>;

export const UpdatePartInput = CreatePartInput.omit({
  stock: true,
  identifiers: true,
  tags: true,
  status: true,
})
  .partial()
  .extend({
    // No defaults here: a partial schema would otherwise fill them in and overwrite the item's values.
    kind: z.enum(PART_KINDS).optional(),
    tracking: z.enum(TRACKING_MODES).optional(),
    aliases: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
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
  kind: z.enum(SEARCH_KINDS).optional().describe('part, tool, device, or build (only builds)'),
  category: z.string().trim().max(300).optional(),
  tag: z.string().trim().max(60).optional(),
  status: z.enum(PART_STATUSES).optional(),
  location: RefSchema.optional().describe(
    'Only things in this location or below it, or units that belong there',
  ),
  inStock: z.boolean().optional(),
  lowStock: z.boolean().optional().describe('Below minimum stock, or marked low/empty'),
  uncounted: z.boolean().optional().describe('Has stock nobody has counted yet'),
  attributes: z
    .array(AttributeFilter)
    .max(10)
    .optional()
    .describe('Filters on category fields, e.g. thread = M4, lengthMm >= 10'),
  /** One result per unit of a tool or device (the search page), or one per part (Inbox, counts). */
  byUnit: z.boolean().default(true),
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

export const LocationTypeInput = z.object({
  name: z.string().trim().min(1).max(60),
  movable: z.boolean().default(false),
  /** A table people bring things to work on: things left there show up the next day. */
  workstation: z.boolean().default(false),
  /** Things made from parts: what's in them isn't free stock, and they can be dismantled. */
  build: z.boolean().default(false),
  stayDays: z.number().int().min(1).max(3650).nullable().default(null),
  sort: z.number().int().min(0).max(1000).optional(),
});
export type LocationTypeInput = z.input<typeof LocationTypeInput>;

export const StockLevelDefSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,40}$/),
  name: z.string().trim().min(1).max(40),
  state: z.enum(LEVEL_STATES),
});

export const LabSettings = z.object({
  /** Things carried longer than this are flagged as probably forgotten. */
  carryForgottenHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 14)
    .default(4),
  /** Tape width the label panels start with. */
  labelTape: z.enum(['9', '12', '24']).default('12'),
  /** What people without an account may do besides looking and reporting problems. */
  anonymousActions: z.enum(ANONYMOUS_ACTIONS).default('workstation'),
  /** Stock levels for stock tracked as a level, best first. */
  stockLevels: z
    .array(StockLevelDefSchema)
    .min(2)
    .max(8)
    .superRefine((levels, ctx) => {
      const keys = new Set(levels.map((l) => l.key));
      const names = new Set(levels.map((l) => l.name.toLowerCase()));
      if (keys.size < levels.length || names.size < levels.length)
        ctx.addIssue({ code: 'custom', message: 'Each level needs its own name' });
    })
    .default(DEFAULT_STOCK_LEVELS),
});
export type LabSettings = z.infer<typeof LabSettings>;

/** A calendar date, "2026-11-30". */
export const DateSchema = z.iso.date();

/** The name someone without an account gives (optional), e.g. "Pekka". */
const ReporterName = z.string().trim().max(80).nullish();

const UnitFields = {
  name: z.string().trim().max(200).nullish().describe('Own name, e.g. "Drill 2"; optional'),
  serialNo: z.string().trim().max(200).nullish(),
  ipAddress: z.string().trim().max(64).nullish(),
  hostname: z.string().trim().max(200).nullish(),
  macAddress: z.string().trim().max(64).nullish(),
  notes: z.string().trim().max(5000).nullish(),
};

export const AddUnitsInput = z.object({
  part: RefSchema,
  units: z
    .array(
      z.object({
        ...UnitFields,
        code: z
          .string()
          .trim()
          .max(16)
          .nullish()
          .describe('Use this code (e.g. from a pre-printed blank label) instead of a new one'),
      }),
    )
    .min(1)
    .max(50),
  location: RefSchema.nullish().describe(
    'Where they are now; defaults to the home place, else the Inbox',
  ),
  home: RefSchema.nullish().describe('Where they belong'),
});
export type AddUnitsInput = z.input<typeof AddUnitsInput>;

export const UpdateUnitInput = z.object({
  ...UnitFields,
  status: z.enum(UNIT_STATUSES).optional(),
  home: RefSchema.nullish().describe('Where it belongs; null to clear'),
  nextCheckAt: DateSchema.nullish().describe('Next maintenance or inspection, YYYY-MM-DD'),
});
export type UpdateUnitInput = z.infer<typeof UpdateUnitInput>;

export const UnitLogInput = z.object({
  kind: z.enum(UNIT_LOG_KINDS).default('note'),
  text: z.string().trim().max(5000).nullish(),
  value: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .describe('For firmware entries: the version now installed, e.g. "V4.6"'),
  nextCheckAt: DateSchema.nullish().describe('Maintenance entries can set the next check date'),
});
export type UnitLogInput = z.infer<typeof UnitLogInput>;

export const ReportInput = z.object({
  owner: z.enum(['unit', 'part', 'location']),
  ref: RefSchema,
  kind: z.enum(REPORT_KINDS).default('broken'),
  note: z.string().trim().max(2000).nullish(),
  name: ReporterName,
});
export type ReportInput = z.infer<typeof ReportInput>;

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
