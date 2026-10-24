import { z } from 'zod';
import { MEASURE_UNITS } from './quantity.js';

/** One row of a spreadsheet, after the person has mapped its columns to these fields. */
export const ImportRow = z.object({
  name: z.string().trim().min(1).max(300),
  manufacturer: z.string().trim().max(200).nullish(),
  orderNo: z.string().trim().max(200).nullish(),
  mpn: z.string().trim().max(200).nullish(),
  category: z.string().trim().max(300).nullish(),
  description: z.string().trim().max(5000).nullish(),
  notes: z.string().trim().max(5000).nullish(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  quantity: z.number().nonnegative().nullish(),
  unit: z.union([z.literal('pcs'), z.enum(MEASURE_UNITS)]).nullish(),
  /** A stock level's key or name; the server checks it against the lab's levels. */
  level: z.string().trim().min(1).max(60).nullish(),
  /** A place code, or a path of names like "Robotics lab › Cabinet A › Shelf 3". */
  location: z.string().trim().max(500).nullish(),
  unitMassG: z.number().positive().nullish(),
});
export type ImportRow = z.infer<typeof ImportRow>;

export const ImportOptions = z.object({
  /** Add stock to a part with the same order number / MPN instead of creating a duplicate. */
  matchExisting: z.boolean().default(true),
  /** Place for rows without one; the Inbox when empty. */
  defaultLocation: z.string().trim().max(64).nullish(),
  /** Recorded on new parts, e.g. the file name. */
  source: z.string().trim().max(500).nullish(),
});
export type ImportOptions = z.infer<typeof ImportOptions>;

export const IMPORT_FIELDS = [
  'name',
  'manufacturer',
  'orderNo',
  'mpn',
  'category',
  'description',
  'notes',
  'tags',
  'quantity',
  'unit',
  'level',
  'location',
  'unitMassG',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Saved column mapping: which spreadsheet column (by header text) feeds which field. */
export const ImportMapping = z.object({
  columns: z.partialRecord(z.enum(IMPORT_FIELDS), z.string().max(200)),
  headerRow: z.number().int().min(1).max(50).default(1),
});
export type ImportMapping = z.infer<typeof ImportMapping>;

export interface ImportResult {
  row: number;
  action: 'create' | 'add_stock' | 'skip' | 'error';
  message: string | null;
  part: { code: string; name: string } | null;
  location: { code: string; name: string } | null;
}
