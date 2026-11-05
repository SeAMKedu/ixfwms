import { z } from 'zod';
import { AddressRootSchema, ShortNameSchema } from './addresses.js';
import { RefSchema, StayDaysSchema } from './common.js';
import { HintSchema, NumberFromSchema } from './directions.js';
import type { LocationKind, NumberFrom, PartStatus } from './enums.js';
import type { AttachmentView } from './files.js';
import type { LoanView } from './loans.js';
import type { UnitBrief } from './units.js';

/* Places: what the API takes to make and change them, and what it returns. */

export const CreateLocationInput = z.object({
  name: z.string().trim().min(1).max(200),
  shortName: ShortNameSchema,
  addressRoot: AddressRootSchema,
  stayDays: StayDaysSchema,
  contact: z.string().trim().max(200).nullish().describe('Who to ask about a temporary place'),
  hint: HintSchema,
  numberFrom: NumberFromSchema,
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
  addressRoot: AddressRootSchema,
  stayDays: StayDaysSchema,
  contact: z.string().trim().max(200).nullish(),
  hint: HintSchema,
  numberFrom: NumberFromSchema,
  type: z.string().trim().min(1).max(40).optional(),
  description: z.string().trim().max(2000).nullish(),
});
export type UpdateLocationInput = z.infer<typeof UpdateLocationInput>;

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

export interface LocationSummary {
  id: string;
  code: string;
  name: string;
  type: string;
  kind: LocationKind;
  /** Short name as set, or null when it's guessed from the name. */
  shortName: string | null;
  /** The address starts here: places above it stay out of it. */
  addressRoot: boolean;
  /** Short name in use, e.g. "C": set, or guessed for fixed places; "" for a container without one. */
  short: string;
  /** Containers (boxes, bins, pallets) move around and aren't part of addresses. */
  movable: boolean;
  /** "Robolab-A-C" for a fixed place; a movable one's is just its short name. */
  address: string;
  /** Address of the fixed place this is in ("Robolab-A"), or "" at the top. */
  within: string;
  /** Temporary places: expected stay in days (null = not temporary), when that runs out, and
   *  whether it has (no stock in or out, no move, nobody said it's still needed). */
  stayDays: number | null;
  dueAt: string | null;
  overdue: boolean;
  /** A workstation (table): anyone may bring things here, and it can be cleared in one go. */
  workstation: boolean;
  /** A build: a thing made from parts (its type is a build type). */
  build: boolean;
  /** The build this place is, or is inside: what's here is built in, not free stock. */
  inBuild: { code: string; name: string } | null;
  /** When a build was taken apart; nothing can be put in it after that. */
  dismantledAt: string | null;
  /** An old container put away: hidden from lists and pickers, nothing can go in it. */
  archivedAt: string | null;
  /** "Out of the lab" itself, or inside a container lent out: nothing goes in or out. */
  outOfLab: boolean;
}

/** A temporary place left untouched longer than expected. */
export interface OverduePlace {
  place: LocationSummary;
  path: LocationSummary[];
  contact: string | null;
  lastActivityAt: string;
}

export interface LocationTypeInfo {
  key: string;
  name: string;
  movable: boolean;
  /** Places of this type are temporary, expected to stay at most this many days. */
  stayDays: number | null;
  workstation: boolean;
  build: boolean;
  sort: number;
  /** How many places are of this type (a type in use can't be removed). */
  places: number;
}

export interface LocationNode extends LocationSummary {
  children: LocationNode[];
}

/** What Clear the bench did: what went back where, and what stayed because nobody knows where it belongs. */
export interface ClearResult {
  returned: { kind: 'unit' | 'lot'; name: string; to: LocationSummary }[];
  left: { kind: 'unit' | 'lot' | 'place'; name: string }[];
}

export interface LocationContentItem {
  lotId: string;
  part: { id: string; code: string; name: string; status: PartStatus; manufacturer: string | null };
  display: string;
  /** Set when the part is in a sub-location rather than directly here. */
  in: LocationSummary | null;
}

export interface LocationDetail extends LocationSummary {
  description: string | null;
  /** How to find it inside its parent ("next to the project workbench"). */
  hint: string | null;
  /** Which way its sub-places are numbered, for directions. */
  numberFrom: NumberFrom | null;
  path: LocationSummary[];
  children: (LocationSummary & { partCount: number })[];
  /** Archived containers here, listed apart so they can be brought back. */
  archived: LocationSummary[];
  contents: LocationContentItem[];
  /** Individually tracked things here or inside (with `in` set for the latter). */
  units: (UnitBrief & { part: { code: string; name: string }; in: LocationSummary | null })[];
  attachments: AttachmentView[];
  /** Fixed places next to this one with the same short name, so the same address. */
  clashes: LocationSummary[];
  /** Own expected stay as set: null = the type's, 0 = not temporary. */
  ownStayDays: number | null;
  /** Expected stay of the place's type, for showing what "the type's" means. */
  typeStayDays: number | null;
  contact: string | null;
  lastActivityAt: string;
  createdAt: string;
  /** Its loan, or the loan of the container it's in, while out of the lab. */
  loan: LoanView | null;
  /** Builds: everything that has been in it (parts and units), for after it's dismantled. */
  wasInIt: { kind: 'part' | 'unit'; code: string; name: string }[];
}

/** A place with its full path of names, for pickers that search by name. */
export interface PlaceOption extends LocationSummary {
  /** Names from the top level down to this place, e.g. ["Robotics lab", "Cabinet A", "Shelf 3"]. */
  path: string[];
  /** Codes along the same path, so a picker can leave out a place and everything inside it. */
  pathCodes: string[];
}
