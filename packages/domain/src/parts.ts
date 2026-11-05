import { z } from 'zod';
import { AmountInput, ContainerInput } from './amount-input.js';
import { type AttributeField, AttributeFilter } from './attributes.js';
import type { BuildBrief } from './builds.js';
import { RefSchema, type SearchResult } from './common.js';
import { CUT_SHAPES, type CutShape } from './cut.js';
import {
  PART_KINDS,
  PART_STATUSES,
  type PartKind,
  type PartStatus,
  SEARCH_KINDS,
  TRACKING_MODES,
  type TrackingMode,
} from './enums.js';
import type { AttachmentView } from './files.js';
import { IDENTIFIER_KINDS } from './identifiers.js';
import type { LocationSummary } from './locations.js';
import type { Container } from './quantity.js';
import type { LotView } from './stock.js';
import type { UnitBrief } from './units.js';

/* Parts (items): creating, changing and searching them, and what the API returns. */

export const IdentifierInput = z.object({
  kind: z.enum(IDENTIFIER_KINDS).default('order_no'),
  value: z.string().trim().min(1).max(200),
  source: z.string().trim().max(200).nullish(),
});
export type IdentifierInput = z.infer<typeof IdentifierInput>;

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
  minStock: z
    .number()
    .nonnegative()
    .nullish()
    .describe("In pieces, or in the container's unit when it has one (g for filament)"),
  container: ContainerInput.nullish().describe(
    'What it comes in (a filament spool, wire reel, box of screws): its empty weight comes off weighings, and a full one can be added as one',
  ),
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
  tags: z.array(z.string().trim().max(60)).max(10).optional().describe('All of these tags'),
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

export interface PartSummary {
  id: string;
  code: string;
  name: string;
  manufacturer: string | null;
  status: PartStatus;
  kind: PartKind;
  tracking: TrackingMode;
  /** Cut stock: by length or as sheets. */
  cut: CutShape | null;
  /** What it comes in (spool, reel, box), when anyone has said. */
  container: Container | null;
  aliases: string[];
  /** Individually tracked items: their units. */
  units: UnitBrief[];
  category: string | null;
  identifiers: { kind: string; value: string }[];
  tags: string[];
  stock: { display: string; location: string; locationCode: string; place: LocationSummary }[];
}

export interface MovementView {
  at: string;
  reason: string;
  delta: number | null;
  fromLocationId: string | null;
  toLocationId: string | null;
  note: string | null;
}

export interface PartDetail extends PartSummary {
  description: string | null;
  unitMassG: number | null;
  minStock: number | null;
  attributes: Record<string, unknown>;
  notes: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  lots: LotView[];
  attachments: AttachmentView[];
  history: MovementView[];
  /** The category's fields (inherited ones included), to label the values in `attributes`. */
  fields: AttributeField[];
}

export interface SimilarPart extends PartSummary {
  score: number;
  reason: string;
}

/** One search result, something to open: a bulk item (no unit), one unit of a tool or device, or a build. */
export type PartSearchRow = { partId: string; unitId: string | null } | { buildId: string };

/** A page of search results. `items` are the parts its rows belong to; `total` counts rows. */
export interface PartSearchResult extends SearchResult<PartSummary> {
  rows: PartSearchRow[];
  /** The builds among `rows`. */
  builds: BuildBrief[];
}
