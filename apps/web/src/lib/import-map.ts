import {
  IMPORT_FIELDS,
  MEASURE_UNITS,
  STOCK_LEVELS,
  type ImportField,
  type ImportRow,
} from '@ixfwms/domain';
import type { Table } from './table';

export type Columns = Partial<Record<ImportField, string>>;

/** Header words that usually mean a field, in English and Finnish. */
const GUESSES: Record<ImportField, RegExp> = {
  name: /^(name|item|description|part|product|nimi|nimike|tuote|kuvaus)$/i,
  manufacturer: /(manufacturer|maker|brand|vendor|valmistaja|merkki)/i,
  orderNo:
    /(order\s*(no|number|code)|art(icle)?\.?\s*(no|nr|number)|part\s*(no|number)|catalog|sku|tilaus(numero|koodi)|tuotenumero|tuotekoodi|nimikekoodi)/i,
  mpn: /^(mpn|manufacturer\s*part)/i,
  category: /(category|group|type|kategoria|ryhmä|tuoteryhmä)/i,
  description: /^(long description|details|lisätiedot)$/i,
  notes: /(notes?|comment|huom|kommentti)/i,
  tags: /(tags?|project|projekti)/i,
  quantity: /^(qty|quantity|amount|count|pcs|määrä|kpl|lukumäärä|saldo)$/i,
  unit: /^(unit|uom|yksikkö)$/i,
  level: /^(level|stock level|taso)$/i,
  location: /(location|place|bin|shelf|box|sijainti|paikka|hylly|laatikko)/i,
  unitMassG: /(weight|mass|paino)/i,
};

/** Suggests a column for each field from the header texts. */
export function guessColumns(headers: string[]): Columns {
  const taken = new Set<string>();
  const out: Columns = {};
  for (const field of IMPORT_FIELDS) {
    const header = headers.find((h) => h.trim() && !taken.has(h) && GUESSES[field].test(h.trim()));
    if (header) {
      out[field] = header;
      taken.add(header);
    }
  }
  return out;
}

/** "1 234,5 kpl" → 1234.5. Empty or unreadable → undefined. */
export function parseQuantity(text: string): number | undefined {
  const cleaned = text.replace(/\s|kpl|pcs|pc|st\.?/gi, '').replace(',', '.');
  if (cleaned === '') return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const UNIT_ALIASES: Record<string, ImportRow['unit']> = {
  kpl: 'pcs',
  pc: 'pcs',
  pcs: 'pcs',
  st: 'pcs',
  ea: 'pcs',
  g: 'g',
  kg: 'kg',
  m: 'm',
  mm: 'mm',
  ml: 'ml',
  l: 'l',
};

export interface MappedRow {
  /** 1-based row number in the file. */
  line: number;
  row: ImportRow | null;
  problem: string | null;
}

/** Turns the table's data rows into import rows using the chosen columns. */
export function mapRows(table: Table, headerRow: number, columns: Columns): MappedRow[] {
  const headers = table[headerRow - 1] ?? [];
  const index = Object.fromEntries(
    Object.entries(columns).map(([field, header]) => [field, headers.indexOf(header)]),
  ) as Partial<Record<ImportField, number>>;
  const cell = (r: string[], field: ImportField) => {
    const i = index[field];
    return i === undefined || i < 0 ? '' : (r[i] ?? '').trim();
  };
  return table.slice(headerRow).map((r, i) => {
    const line = headerRow + i + 1;
    const name = cell(r, 'name');
    if (!name) return { line, row: null, problem: 'no name' };
    const qtyText = cell(r, 'quantity');
    const quantity = parseQuantity(qtyText);
    if (qtyText && quantity === undefined)
      return { line, row: null, problem: `can't read amount "${qtyText}"` };
    const unitText = cell(r, 'unit').toLowerCase();
    const unit = unitText ? UNIT_ALIASES[unitText] : undefined;
    if (unitText && !unit)
      return {
        line,
        row: null,
        problem: `unknown unit "${unitText}" (use ${['pcs', ...MEASURE_UNITS].join(', ')})`,
      };
    const levelText = cell(r, 'level').toLowerCase();
    const level = (STOCK_LEVELS as readonly string[]).includes(levelText)
      ? (levelText as ImportRow['level'])
      : undefined;
    const optional = (field: ImportField) => cell(r, field) || null;
    return {
      line,
      problem: null,
      row: {
        name,
        manufacturer: optional('manufacturer'),
        orderNo: optional('orderNo'),
        mpn: optional('mpn'),
        category: optional('category'),
        description: optional('description'),
        notes: optional('notes'),
        tags: cell(r, 'tags')
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean),
        quantity: quantity ?? null,
        unit: unit ?? null,
        level: level ?? null,
        location: optional('location'),
        unitMassG: parseQuantity(cell(r, 'unitMassG')) || null,
      },
    };
  });
}
