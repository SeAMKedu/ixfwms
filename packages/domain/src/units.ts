import { z } from 'zod';
import { DateSchema, RefSchema } from './common.js';
import {
  type PartKind,
  UNIT_LOG_KINDS,
  UNIT_STATUSES,
  type UnitEventKind,
  type UnitStatus,
} from './enums.js';
import type { UnitPurchase } from './finance.js';
import type { LoanView } from './loans.js';
import type { LocationSummary } from './locations.js';
import type { ReportView } from './reports.js';

/* Units: individual things with codes, their log, status and network details. */

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
  purchaseDate: DateSchema.nullish().describe('When it was bought, YYYY-MM-DD'),
  purchaseValueCents: z
    .number()
    .int()
    .min(0)
    .max(100_000_000_000)
    .nullish()
    .describe('What it cost, in euro cents'),
  costCenter: z.string().trim().max(60).nullish().describe('Cost center (kustannuspaikka)'),
  usefulLifeYears: z
    .number()
    .int()
    .min(1)
    .max(100)
    .nullish()
    .describe('Estimated useful life in years, for depreciation'),
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

/** One individually tracked thing, as shown in lists. */
export interface UnitBrief {
  id: string;
  code: string;
  /** Own name, or the item's name with the code ("Impact drill A3F9"). */
  name: string;
  ownName: string | null;
  serialNo: string | null;
  status: UnitStatus;
  location: LocationSummary;
  home: LocationSummary | null;
  /** At its home place or somewhere inside it. */
  atHome: boolean;
  loan: LoanView | null;
  /** When it last moved or had a log entry. */
  lastSeenAt: string;
}

export interface UnitEventView {
  id: string;
  kind: UnitEventKind;
  text: string | null;
  value: string | null;
  from: LocationSummary | null;
  to: LocationSummary | null;
  /** User name, or the name someone without an account gave (then `guest` is true). */
  by: string | null;
  guest: boolean;
  at: string;
}

export interface UnitDetail extends UnitBrief {
  part: { id: string; code: string; name: string; kind: PartKind; category: string | null };
  path: LocationSummary[];
  homePath: LocationSummary[];
  /** Network details; null for people who aren't logged in (see networkHidden). */
  ipAddress: string | null;
  hostname: string | null;
  macAddress: string | null;
  networkHidden: boolean;
  /** Null for people who can't change inventory. */
  purchase: UnitPurchase | null;
  notes: string | null;
  nextCheckAt: string | null;
  /** The next check date has come. */
  checkDue: boolean;
  /** Latest firmware/software log entry. */
  firmware: { version: string; at: string } | null;
  createdAt: string;
  events: UnitEventView[];
  loans: LoanView[];
  /** Open problem reports. */
  reports: ReportView[];
}

/** A unit that needs someone: reported, broken, in repair, or due for a check. */
export interface UnitAttention {
  unit: UnitBrief;
  part: { code: string; name: string };
  reason: 'status' | 'check_due';
  nextCheckAt: string | null;
}

export interface NetworkEntry {
  unit: { code: string; name: string };
  part: { code: string; name: string };
  ipAddress: string | null;
  hostname: string | null;
  macAddress: string | null;
  place: string;
}
