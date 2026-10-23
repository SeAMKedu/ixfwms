/*
 * Colour values are stored as { name, hex }: the hex keeps the exact shade, the name is one of the
 * palette's base colours so searching "blue" finds every blue, and the UI can translate it.
 * The palette follows the IEC 60757 wire colour codes, plus a few filament colours.
 */

export interface PaletteColour {
  name: string;
  hex: string;
  /** IEC 60757 code (wires), also accepted as input. */
  iec: string | null;
}

export const COLOUR_PALETTE: readonly PaletteColour[] = [
  { name: 'black', hex: '#1b1b1b', iec: 'BK' },
  { name: 'brown', hex: '#7a4a24', iec: 'BN' },
  { name: 'red', hex: '#d32f2f', iec: 'RD' },
  { name: 'orange', hex: '#f57c00', iec: 'OG' },
  { name: 'yellow', hex: '#fbc02d', iec: 'YE' },
  { name: 'green', hex: '#388e3c', iec: 'GN' },
  { name: 'blue', hex: '#1e64c8', iec: 'BU' },
  { name: 'violet', hex: '#7b1fa2', iec: 'VT' },
  { name: 'grey', hex: '#8a8f94', iec: 'GY' },
  { name: 'white', hex: '#f7f7f5', iec: 'WH' },
  { name: 'pink', hex: '#ec6fa6', iec: 'PK' },
  { name: 'turquoise', hex: '#1fb5b0', iec: 'TQ' },
  { name: 'green-yellow', hex: '#9ccc3d', iec: 'GNYE' },
  { name: 'silver', hex: '#c0c4c8', iec: 'SR' },
  { name: 'gold', hex: '#c9a227', iec: 'GD' },
  { name: 'transparent', hex: '#e8f1f4', iec: null },
] as const;

export interface ColourValue {
  /** Palette base colour, or null when nothing fits (only for values set by hand). */
  name: string | null;
  /** "#rrggbb", lower case. */
  hex: string;
}

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

function normalizeHex(text: string): string | null {
  const m = HEX.exec(text.trim());
  if (!m?.[1]) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The palette colour closest to a hex shade (weighted RGB distance, good enough for naming). */
export function nearestColourName(hex: string): string {
  const [r, g, b] = rgb(normalizeHex(hex) ?? '#000000');
  let best = COLOUR_PALETTE[0]!;
  let bestDistance = Infinity;
  for (const c of COLOUR_PALETTE) {
    if (c.name === 'transparent') continue;
    const [cr, cg, cb] = rgb(c.hex);
    const d = 2 * (r - cr) ** 2 + 4 * (g - cg) ** 2 + 3 * (b - cb) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  return best.name;
}

export function paletteColour(name: string): PaletteColour | undefined {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[\s_/]+/g, '-');
  return COLOUR_PALETTE.find(
    (c) => c.name === key || c.iec?.toLowerCase() === key.replace(/-/g, ''),
  );
}

/**
 * Turns whatever was given (a palette name, an IEC code like "BU", a hex, or a stored value)
 * into { name, hex }. Returns null for empty input; unknown words keep their text as the name.
 */
export function toColourValue(input: unknown): ColourValue | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'object') {
    const o = input as { name?: unknown; hex?: unknown };
    const hex = typeof o.hex === 'string' ? normalizeHex(o.hex) : null;
    const named =
      typeof o.name === 'string' && o.name.trim()
        ? (paletteColour(o.name)?.name ?? o.name.trim().toLowerCase())
        : null;
    if (hex) return { name: named ?? nearestColourName(hex), hex };
    return named ? toColourValue(named) : null;
  }
  const text = typeof input === 'string' || typeof input === 'number' ? String(input).trim() : '';
  const hex = normalizeHex(text);
  if (hex) return { name: nearestColourName(hex), hex };
  const palette = paletteColour(text);
  if (palette) return { name: palette.name, hex: palette.hex };
  return { name: text.toLowerCase(), hex: '#9e9e9e' };
}
