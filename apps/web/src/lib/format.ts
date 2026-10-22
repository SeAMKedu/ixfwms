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
