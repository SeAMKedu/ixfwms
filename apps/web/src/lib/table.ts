/** A spreadsheet as rows of text cells. */
export type Table = string[][];

/** Picks the delimiter used in the first lines: Finnish Excel exports CSV with semicolons, others with commas or tabs. */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 5).join('\n');
  const counts = [',', ';', '\t'].map((d) => [d, sample.split(d).length - 1] as const);
  return [...counts].sort((a, b) => b[1] - a[1])[0]![0];
}

/** RFC 4180-style parser: quoted fields, doubled quotes, newlines inside quotes. */
export function parseDelimited(text: string, delimiter = detectDelimiter(text)): Table {
  const rows: Table = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Reads a CSV/TSV text file or the first sheet of an .xlsx file. */
export async function readTable(file: File): Promise<Table> {
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/browser');
    const data = await readSheet(file);
    return data
      .map((r) =>
        r.map((c) =>
          c === null || c === undefined
            ? ''
            : c instanceof Date
              ? c.toISOString().slice(0, 10)
              : String(c),
        ),
      )
      .filter((r) => r.some((c) => c.trim() !== ''));
  }
  return parseDelimited(await file.text());
}
