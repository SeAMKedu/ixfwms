import type { BomLine } from '@ixfwms/domain';
import { parseQuantity } from './import-map';
import type { Table } from './table';

export interface BomColumns {
  ref?: string;
  name?: string;
  quantity?: string;
}

/** Header words used by CAD, EPLAN and TIA Portal exports (English, Finnish, German). */
const GUESS: Record<keyof BomColumns, RegExp> = {
  ref: /(order|part\s*(no|number)|art(icle)?\.?\s*(no|nr)|mlfb|code|mpn|tilaus|tuotenumero|nimikekoodi|bestell|artikelnummer|document number)/i,
  name: /(name|description|title|nimi|nimike|kuvaus|bezeichnung|benennung)/i,
  quantity: /^(qty|quantity|amount|count|pcs|määrä|kpl|lukumäärä|menge|anzahl|item count)$/i,
};

export function guessBomColumns(headers: string[]): BomColumns {
  const out: BomColumns = {};
  const taken = new Set<string>();
  for (const field of ['ref', 'quantity', 'name'] as const) {
    const header = headers.find((h) => h.trim() && !taken.has(h) && GUESS[field].test(h.trim()));
    if (header) {
      out[field] = header;
      taken.add(header);
    }
  }
  return out;
}

/** Table rows → BOM lines, multiplying quantities by the number of sets. Rows without a code or name are dropped. */
export function toBomLines(
  table: Table,
  headerRow: number,
  columns: BomColumns,
  sets: number,
): BomLine[] {
  const headers = table[headerRow - 1] ?? [];
  const at = (r: string[], header?: string) =>
    header ? (r[headers.indexOf(header)] ?? '').trim() : '';
  return table
    .slice(headerRow)
    .map((r) => ({
      ref: at(r, columns.ref) || null,
      name: at(r, columns.name) || null,
      quantity: (parseQuantity(at(r, columns.quantity)) || 1) * sets,
    }))
    .filter((l) => l.ref || l.name);
}
