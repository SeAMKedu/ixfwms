/*
 * Cut stock: bars (profiles, rod, tube) and sheets (sheet metal, MDF, plastic) kept as a list of
 * pieces with their sizes, so offcuts stay pieces of their own: a 6 m bar cut for a 40 cm part
 * is a 5.6 m bar and, once the part comes back, a 40 cm offcut, not "6 m". Sizes are in mm.
 */

/** How an item is cut: by length (bars) or as sheets (width × height). */
export const CUT_SHAPES = ['length', 'sheet'] as const;
export type CutShape = (typeof CUT_SHAPES)[number];

/** One piece in mm: [length] for a bar, [width, height] for a sheet. */
export type Piece = number[];

/** What stays of a sheet after a cut: two straight cuts leave two strips, kept either way. */
export const LEFTOVERS = ['across', 'along', 'scrap'] as const;
export type Leftover = (typeof LEFTOVERS)[number];

export const shapeOf = (p: Piece): CutShape => (p.length === 2 ? 'sheet' : 'length');
const dims = (shape: CutShape) => (shape === 'sheet' ? 2 : 1);

/** "400", "1250x2500", "1250 × 2500 mm": a size, or null when it isn't one for this shape. */
export function parseSize(text: string, shape: CutShape): Piece | null {
  const parts = text
    .toLowerCase()
    .replace(/mm/g, '')
    .split(/\s*[x×*]\s*/)
    .map((s) => Number(s.trim().replace(',', '.')));
  if (parts.length !== dims(shape) || parts.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  return parts;
}

/**
 * "5600, 400" or "1250x2500; 2 × 600x400" (one per line works too): the pieces, or null when
 * something isn't a size. "3 × 6000" is three bars of 6 m.
 */
export function parsePieces(text: string, shape: CutShape): Piece[] | null {
  const out: Piece[] = [];
  for (const raw of text.split(/[,;\n]+/).map((s) => s.trim())) {
    if (!raw) continue;
    // A size as such, or "how many × size".
    const many = /^(\d+)\s*(?:pcs|kpl)?\s*[x×*@]\s*(.+)$/i.exec(raw);
    const size = parseSize(raw, shape) ?? (many ? parseSize(many[2]!, shape) : null);
    const times = parseSize(raw, shape) ? 1 : Number(many?.[1] ?? 0);
    if (!size || times < 1 || times > 1000) return null;
    for (let i = 0; i < times; i++) out.push(size);
  }
  return out;
}

const mm = (n: number) => String(Math.round(n * 10) / 10);

/** "400 mm", "5.6 m", "1250 × 2500". */
export function formatPiece(p: Piece): string {
  if (p.length === 2) return `${mm(p[0]!)} × ${mm(p[1]!)}`;
  const n = p[0]!;
  return n >= 1000 ? `${Math.round(n) / 1000} m` : `${mm(n)} mm`;
}

/** Total length (m) or area (m²) of pieces, as text: "6 m", "3.4 m²". */
export function formatTotal(pieces: Piece[]): string {
  if (!pieces.length) return '0';
  const sheet = shapeOf(pieces[0]!) === 'sheet';
  const total = pieces.reduce((s, p) => s + (sheet ? p[0]! * p[1]! : p[0]!), 0);
  const value = sheet ? total / 1e6 : total / 1000;
  return `${Math.round(value * 100) / 100} ${sheet ? 'm²' : 'm'}`;
}

/** "2 pieces: 5.6 m, 400 mm (6 m)"; longest or largest first. */
export function formatPieces(pieces: Piece[]): string {
  if (!pieces.length) return '0 pieces';
  const sheet = shapeOf(pieces[0]!) === 'sheet';
  const sorted = [...pieces].sort((a, b) => area(b) - area(a));
  const noun = sheet
    ? pieces.length === 1
      ? 'sheet'
      : 'sheets'
    : pieces.length === 1
      ? 'piece'
      : 'pieces';
  const total = pieces.length > 1 ? ` (${formatTotal(pieces)})` : '';
  return `${pieces.length} ${noun}: ${sorted.map(formatPiece).join(', ')}${total}`;
}

const area = (p: Piece) => (p.length === 2 ? p[0]! * p[1]! : p[0]!);

/** `size` turned to fit in `piece` (a sheet may be turned), or null when it doesn't fit. */
export function fitIn(piece: Piece, size: Piece): Piece | null {
  if (piece.length !== size.length) return null;
  if (size.length === 1) return size[0]! <= piece[0]! ? size : null;
  const [w, h] = size as [number, number];
  const [W, H] = piece as [number, number];
  if (w <= W && h <= H) return [w, h];
  if (h <= W && w <= H) return [h, w];
  return null;
}

/** The piece to cut `size` from: the smallest it fits in, so offcuts go before full bars. */
export function pickPiece(pieces: Piece[], size: Piece): number {
  let best = -1;
  pieces.forEach((p, i) => {
    if (fitIn(p, size) && (best < 0 || area(p) < area(pieces[best]!))) best = i;
  });
  return best;
}

/** How many of `size` could be cut from one piece (a sheet in a plain grid, either way round). */
export function cutsFrom(piece: Piece, size: Piece): number {
  if (piece.length !== size.length) return 0;
  if (size.length === 1) return Math.floor(piece[0]! / size[0]!);
  const [W, H] = piece as [number, number];
  const [w, h] = size as [number, number];
  return Math.max(Math.floor(W / w) * Math.floor(H / h), Math.floor(W / h) * Math.floor(H / w));
}

/**
 * What stays of `piece` after cutting `size` from its corner. A bar: the rest of it. A sheet:
 * cut `across` first (a full-height strip beside the part, and a strip above it) or `along`
 * first (a full-width strip above, and a strip beside); `scrap` keeps nothing. Slivers under
 * 1 mm are dropped.
 */
export function leftovers(piece: Piece, size: Piece, how: Leftover = 'across'): Piece[] {
  const fit = fitIn(piece, size);
  if (!fit || how === 'scrap') return [];
  if (piece.length === 1) return piece[0]! - fit[0]! >= 1 ? [[piece[0]! - fit[0]!]] : [];
  const [W, H] = piece as [number, number];
  const [w, h] = fit as [number, number];
  const strips: Piece[] =
    how === 'across'
      ? [
          [W - w, H],
          [w, H - h],
        ]
      : [
          [W, H - h],
          [W - w, h],
        ];
  return strips.filter((p) => p[0]! >= 1 && p[1]! >= 1);
}

/** The way of cutting a sheet that keeps the biggest piece whole. */
export function bestLeftover(piece: Piece, size: Piece): Exclude<Leftover, 'scrap'> {
  const biggest = (how: Leftover) => Math.max(0, ...leftovers(piece, size, how).map(area));
  return biggest('along') > biggest('across') ? 'along' : 'across';
}
