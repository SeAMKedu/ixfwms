import i18n from '../i18n';

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'kB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}

/** Splits "a, b,, c" into ["a", "b", "c"]. */
export function splitList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseNumber(text: string): number | undefined {
  const n = Number(text.replace(',', '.'));
  return text.trim() === '' || Number.isNaN(n) ? undefined : n;
}

/** A calendar date ("2026-11-30") as the reader writes dates. */
export function formatDay(day: string): string {
  return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
    new Date(`${day.slice(0, 10)}T12:00:00`),
  );
}

export function formatEuros(cents: number): string {
  return new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'EUR' }).format(
    cents / 100,
  );
}

/** "1 234,50" as cents; null when empty. The field's pattern keeps out anything else. */
export function parseEuros(text: string): number | null {
  const n = Number(text.replace(/\s/g, '').replace(',', '.'));
  return text.trim() === '' || Number.isNaN(n) ? null : Math.round(n * 100);
}
