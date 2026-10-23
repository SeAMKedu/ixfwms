import { z } from 'zod';

/*
 * Category fields ("attribute templates"): each category can define the details that matter for
 * its parts, e.g. thread and length for screws. Sub-categories inherit their parents' fields.
 * Values live in Part.attributes under the field key, so templates can change without migrations.
 */

export const ATTRIBUTE_TYPES = ['text', 'number', 'enum', 'bool', 'colour'] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

const KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/;

export const AttributeField = z.object({
  key: z.string().regex(KEY, 'Keys are letters, digits and _, starting with a letter'),
  label: z.string().trim().min(1).max(60),
  type: z.enum(ATTRIBUTE_TYPES).default('text'),
  unit: z.string().trim().max(10).nullish(),
  options: z.array(z.string().trim().min(1).max(40)).max(60).nullish(),
});
export type AttributeField = z.infer<typeof AttributeField>;

export const AttributeFields = z.array(AttributeField).max(40);

/** Fields of a category path, inheriting from its parents; a child's field replaces a parent's with the same key. */
export function effectiveFields(chain: (AttributeField[] | null | undefined)[]): AttributeField[] {
  const byKey = new Map<string, AttributeField>();
  for (const fields of chain) for (const f of fields ?? []) byKey.set(f.key, f);
  return [...byKey.values()];
}

export const ATTRIBUTE_OPS = ['eq', 'contains', 'gte', 'lte'] as const;
export type AttributeOp = (typeof ATTRIBUTE_OPS)[number];

export const AttributeFilter = z.object({
  key: z.string().regex(KEY),
  op: z.enum(ATTRIBUTE_OPS).default('eq'),
  value: z.union([z.string().max(100), z.number()]),
});
export type AttributeFilter = z.infer<typeof AttributeFilter>;

const FILTER_PATTERN = /^([a-zA-Z][a-zA-Z0-9_]{0,40})\s*(>=|<=|~|:|=)\s*(.+)$/;
const OP_BY_SYMBOL: Record<string, AttributeOp> = {
  '>=': 'gte',
  '<=': 'lte',
  '~': 'contains',
  ':': 'eq',
  '=': 'eq',
};
const SYMBOL_BY_OP: Record<AttributeOp, string> = { gte: '>=', lte: '<=', contains: '~', eq: ':' };

/** Parses "thread:M4", "lengthMm>=10", "material~a2" (contains). Numbers compare as numbers. */
export function parseAttributeFilter(text: string): AttributeFilter | null {
  const m = FILTER_PATTERN.exec(text.trim());
  if (!m?.[1] || !m[2] || m[3] === undefined) return null;
  const op = OP_BY_SYMBOL[m[2]]!;
  const raw = m[3].trim();
  const num = Number(raw.replace(',', '.'));
  const numeric = op === 'gte' || op === 'lte';
  if (numeric && Number.isNaN(num)) return null;
  return { key: m[1], op, value: numeric ? num : raw };
}

export function formatAttributeFilter(f: AttributeFilter): string {
  return `${f.key}${SYMBOL_BY_OP[f.op]}${f.value}`;
}

const METRIC_THREADS = ['M2', 'M2.5', 'M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12'];

/** Starter fields for typical lab categories; applied with `npm run cli -- seed:categories`. */
export const STARTER_CATEGORIES: Record<string, AttributeField[]> = {
  Fasteners: [
    { key: 'thread', label: 'Thread', type: 'enum', options: METRIC_THREADS },
    { key: 'standard', label: 'Standard', type: 'text', unit: null, options: null },
    {
      key: 'material',
      label: 'Material',
      type: 'enum',
      options: ['A2', 'A4', 'steel 8.8', 'steel 10.9', 'steel 12.9', 'brass', 'nylon'],
    },
  ],
  'Fasteners/Screws': [
    { key: 'lengthMm', label: 'Length', type: 'number', unit: 'mm', options: null },
    {
      key: 'head',
      label: 'Head',
      type: 'enum',
      options: ['socket', 'button', 'countersunk', 'hex', 'pan', 'set screw'],
    },
  ],
  'Fasteners/Nuts': [
    {
      key: 'kind',
      label: 'Kind',
      type: 'enum',
      options: ['hex', 'nyloc', 'flange', 'T-slot', 'square', 'wing'],
    },
  ],
  'Fasteners/Washers': [
    { key: 'kind', label: 'Kind', type: 'enum', options: ['flat', 'spring', 'large', 'serrated'] },
  ],
  'Pneumatics/Vacuum/Suction cups': [
    { key: 'diameterMm', label: 'Diameter', type: 'number', unit: 'mm', options: null },
    {
      key: 'shape',
      label: 'Shape',
      type: 'enum',
      options: ['flat', 'bellows 1.5', 'bellows 2.5', 'oval', 'deep'],
    },
    {
      key: 'material',
      label: 'Material',
      type: 'enum',
      options: ['NBR', 'SI', 'PU', 'FPM', 'NR', 'HT1'],
    },
    { key: 'connection', label: 'Connection', type: 'text', unit: null, options: null },
  ],
  'Pneumatics/Vacuum/Ejectors': [
    { key: 'nozzleMm', label: 'Nozzle', type: 'number', unit: 'mm', options: null },
    { key: 'maxVacuumPct', label: 'Max vacuum', type: 'number', unit: '%', options: null },
  ],
  'Pneumatics/Fittings': [
    { key: 'tubeOdMm', label: 'Tube OD', type: 'number', unit: 'mm', options: null },
    {
      key: 'thread',
      label: 'Thread',
      type: 'enum',
      options: ['M5', 'G1/8', 'G1/4', 'G3/8', 'R1/8', 'R1/4', 'none'],
    },
    {
      key: 'shape',
      label: 'Shape',
      type: 'enum',
      options: ['straight', 'elbow', 'tee', 'Y', 'union', 'plug'],
    },
  ],
  'Pneumatics/Tubing': [
    { key: 'odMm', label: 'Outer diameter', type: 'number', unit: 'mm', options: null },
    { key: 'idMm', label: 'Inner diameter', type: 'number', unit: 'mm', options: null },
    {
      key: 'material',
      label: 'Material',
      type: 'enum',
      options: ['PU', 'PA', 'PE', 'PTFE', 'silicone'],
    },
    { key: 'colour', label: 'Colour', type: 'colour', unit: null, options: null },
  ],
  'Electrical/Wire': [
    { key: 'crossSectionMm2', label: 'Cross-section', type: 'number', unit: 'mm²', options: null },
    { key: 'cores', label: 'Cores', type: 'number', unit: null, options: null },
    { key: 'colour', label: 'Colour', type: 'colour', unit: null, options: null },
  ],
  'Electrical/Terminal blocks': [
    {
      key: 'crossSectionMm2',
      label: 'Max cross-section',
      type: 'number',
      unit: 'mm²',
      options: null,
    },
    {
      key: 'connection',
      label: 'Connection',
      type: 'enum',
      options: ['push-in', 'screw', 'spring', 'IDC'],
    },
  ],
  'Electrical/PLC': [
    { key: 'family', label: 'Family', type: 'text', unit: null, options: null },
    { key: 'supply', label: 'Supply', type: 'enum', options: ['24 V DC', '230 V AC', 'other'] },
  ],
  Filament: [
    {
      key: 'material',
      label: 'Material',
      type: 'enum',
      options: ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'PLA-CF', 'PETG-CF'],
    },
    { key: 'colour', label: 'Colour', type: 'colour', unit: null, options: null },
    { key: 'diameterMm', label: 'Diameter', type: 'number', unit: 'mm', options: null },
  ],
};
