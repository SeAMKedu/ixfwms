import type { NumberFrom } from '@ixfwms/domain';
import { and, asc, inArray, isNull } from 'drizzle-orm';
import { many, type Executor } from '../db/client.js';
import { locations } from '../db/schema.js';
import type { LocationRow } from './locations.js';

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** A place to draw, with the places inside it to draw within it, sized to hold them. */
interface Box {
  code: string;
  label: string;
  w: number;
  h: number;
  inner: Placed[];
}

interface Placed {
  box: Box;
  x: number;
  y: number;
}

const [W, H, INNER_W, INNER_H] = [180, 110, 110, 56];
const [GAP, INNER_GAP, PAD, INNER_PAD, HEAD] = [30, 10, 40, 12, 44];

/**
 * A starting point for drawing a map of `loc`: one labelled box per sub-place and, inside each,
 * one per place inside that (rows with their drawers), all carrying the right ids. Places whose
 * parent says which way they are numbered go in one column or row in that order (cabinet rows
 * from the top, drawers from the left); others in a grid. Move and reshape them in Inkscape.
 */
export async function starterSvg(ex: Executor, loc: LocationRow): Promise<string> {
  const children = await inside(ex, [loc.id]);
  const grandchildren = await inside(
    ex,
    children.map((c) => c.id),
  );
  const boxes = sorted(children, loc.numberFrom).map((c): Box => {
    const kids = grandchildren.filter((g) => g.parentId === c.id);
    if (!kids.length) return { code: c.code, label: c.name, w: W, h: H, inner: [] };
    const small = sorted(kids, c.numberFrom).map((k): Box => ({
      code: k.code,
      label: k.shortName || k.name,
      w: INNER_W,
      h: INNER_H,
      inner: [],
    }));
    const laid = layout(small, c.numberFrom, INNER_GAP);
    return {
      code: c.code,
      label: c.name,
      w: Math.max(W, laid.w + INNER_PAD * 2),
      h: HEAD + laid.h + INNER_PAD,
      inner: laid.placed,
    };
  });
  const laid = layout(boxes, loc.numberFrom, GAP);
  const width = PAD * 2 + Math.max(laid.w, 200);
  const height = PAD * 2 + 40 + laid.h;
  const shapes = laid.placed.map(({ box, x, y }) => draw(box, PAD + x, PAD + 40 + y)).join('\n  ');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n` +
    `  <!-- ixfwms starter map for ${esc(loc.name)} (${loc.code}). Rearrange freely; shapes can also be linked by clicking them in ixfwms. -->\n` +
    `  <rect width="${width}" height="${height}" fill="#ffffff"/>\n` +
    `  <text x="${PAD}" y="${PAD + 8}" font-family="sans-serif" font-size="22" font-weight="bold" fill="#15202a">${esc(loc.name)}</text>\n` +
    `  ${shapes}\n</svg>\n`
  );
}

/** Places directly inside any of `parentIds`, archived ones left out. */
async function inside(ex: Executor, parentIds: string[]): Promise<LocationRow[]> {
  if (!parentIds.length) return [];
  return many(
    ex
      .select()
      .from(locations)
      .where(and(inArray(locations.parentId, parentIds), isNull(locations.archivedAt)))
      .orderBy(asc(locations.name)),
  );
}

/** In counting order: by short name, else name ("1, 2, 10"), the first at the start it's counted from. */
function sorted<T extends Pick<LocationRow, 'name' | 'shortName'>>(
  rows: T[],
  from: NumberFrom | null,
): T[] {
  const out = [...rows].sort((a, b) =>
    byName.compare(a.shortName || a.name, b.shortName || b.name),
  );
  return from === 'bottom' || from === 'right' ? out.reverse() : out;
}

/** One column (numbered top or bottom), one row (left or right), or a near-square grid. */
function layout(boxes: Box[], from: NumberFrom | null, gap: number) {
  const cols =
    from === 'top' || from === 'bottom'
      ? 1
      : from === 'left' || from === 'right'
        ? Math.max(1, boxes.length)
        : Math.max(1, Math.ceil(Math.sqrt(boxes.length)));
  const cellW = Math.max(0, ...boxes.map((b) => b.w));
  const cellH = Math.max(0, ...boxes.map((b) => b.h));
  const rows = Math.max(1, Math.ceil(boxes.length / cols));
  const placed = boxes.map((box, i) => ({
    box,
    x: (i % cols) * (cellW + gap),
    y: Math.floor(i / cols) * (cellH + gap),
  }));
  const used = Math.min(cols, Math.max(1, boxes.length));
  return { placed, w: used * cellW + (used - 1) * gap, h: rows * cellH + (rows - 1) * gap };
}

/**
 * A box and its label as one linked group, then the boxes inside it as groups of their own after
 * it (not nested), so a click or a highlight on a drawer is the drawer's, not its row's.
 */
function draw(box: Box, x: number, y: number): string {
  const nested = box.inner.length > 0;
  const own =
    `<g id="loc:${box.code}"><rect x="${x}" y="${y}" width="${box.w}" height="${box.h}" rx="4" fill="#f6f8f8" stroke="#586672" stroke-width="2"/>` +
    `<text x="${x + 12}" y="${y + 26}" font-family="sans-serif" font-size="16" fill="#15202a">${esc(box.label)}</text>` +
    `<text x="${x + 12}" y="${y + (nested ? 40 : 50)}" font-family="monospace" font-size="${nested ? 11 : 13}" fill="#586672">${box.code}</text></g>`;
  const inner = box.inner.map(({ box: b, x: dx, y: dy }) => {
    const [bx, by] = [x + INNER_PAD + dx, y + HEAD + dy];
    return (
      `<g id="loc:${b.code}"><rect x="${bx}" y="${by}" width="${b.w}" height="${b.h}" rx="3" fill="#ffffff" stroke="#586672" stroke-width="1.5"/>` +
      `<text x="${bx + 8}" y="${by + 22}" font-family="sans-serif" font-size="13" fill="#15202a">${esc(b.label)}</text>` +
      `<text x="${bx + 8}" y="${by + 40}" font-family="monospace" font-size="11" fill="#586672">${b.code}</text></g>`
    );
  });
  return [own, ...inner].join('\n  ');
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
