import type { LabelData } from '@ixfwms/domain';
import QRCode from 'qrcode';

export type { LabelData };

/*
 * Label rendering: QR codes as vector SVG (screens, phone printing, laser engravers),
 * DXF (laser/CAD), and CSV for P-touch Editor's database merge. Pure functions, no I/O.
 */

export type ErrorCorrection = 'L' | 'M' | 'Q' | 'H';
export type TapeWidth = 9 | 12 | 24;

/** Printable height per tape width on the PT-E560BT (approximate; confirm with a test print). */
const PRINTABLE_MM: Record<TapeWidth, number> = { 9: 7, 12: 9, 24: 18 };

const QUIET = 2;

interface Matrix {
  size: number;
  dark(x: number, y: number): boolean;
}

export function qrMatrix(text: string, ecl: ErrorCorrection = 'M'): Matrix {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: ecl });
  return { size: modules.size, dark: (x, y) => modules.get(y, x) === 1 };
}

/** Horizontal runs of dark modules: fewer, larger shapes engrave and cut cleaner than single squares. */
function runs(m: Matrix): { x: number; y: number; w: number }[] {
  const out: { x: number; y: number; w: number }[] = [];
  for (let y = 0; y < m.size; y++) {
    let x = 0;
    while (x < m.size) {
      if (!m.dark(x, y)) {
        x++;
        continue;
      }
      const start = x;
      while (x < m.size && m.dark(x, y)) x++;
      out.push({ x: start, y, w: x - start });
    }
  }
  return out;
}

function qrPath(m: Matrix, offsetX: number, offsetY: number, moduleSize: number): string {
  return runs(m)
    .map(
      (r) =>
        `M${fmt(offsetX + r.x * moduleSize)} ${fmt(offsetY + r.y * moduleSize)}h${fmt(r.w * moduleSize)}v${fmt(moduleSize)}h${fmt(-r.w * moduleSize)}z`,
    )
    .join('');
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

const escapeXml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );

/** Just the QR code with a quiet zone, `sizeMm` wide. */
export function qrSvg(text: string, opts: { sizeMm?: number; ecl?: ErrorCorrection } = {}): string {
  const m = qrMatrix(text, opts.ecl);
  const total = m.size + QUIET * 2;
  const size = opts.sizeMm ?? total;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}mm" height="${size}mm" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#fff"/><path fill="#000" d="${qrPath(m, QUIET, QUIET, 1)}"/></svg>`
  );
}

/** Rough text width for the monospace/sans fonts used on labels, so the label length fits its text. */
const textWidth = (text: string, fontMm: number, mono = false) =>
  text.length * fontMm * (mono ? 0.62 : 0.55);

/** One line of label text; `small` is printed before the main text at a smaller size. */
interface Line {
  text: string;
  size: number;
  mono: boolean;
  bold: boolean;
  small?: string;
}

/**
 * A complete tape label in millimetres: QR on the left, text on the right. Fixed places show their
 * address ("Robolab-A-" small, "C" large); containers, parts and blank labels show the code.
 * 9 mm: QR + address or code. 12 mm: + name. 24 mm: + name and path.
 * Units (tools, devices) show their name and home address instead; the code is in the QR.
 */
export function labelSvg(label: LabelData, tape: TapeWidth, ecl: ErrorCorrection = 'M'): string {
  const h = PRINTABLE_MM[tape];
  const m = qrMatrix(label.qr, ecl);
  const modules = m.size + QUIET * 2;
  const mod = h / modules;
  const gap = h * 0.12;
  const x0 = h + gap;
  const byAddress = label.kind === 'location' && !label.movable && label.short !== '';
  const main = (size: number): Line =>
    byAddress
      ? {
          text: truncate(label.short, 12),
          small: label.parent ? truncate(`${label.parent}-`, 24) : undefined,
          size,
          mono: true,
          bold: true,
        }
      : { text: label.code, size, mono: true, bold: true };
  const lines: Line[] = label.kind === 'unit' ? unitLines(label, tape, h) : [];
  if (label.kind === 'unit') {
    // filled in above
  } else if (tape === 9) {
    lines.push(main(h * 0.5));
  } else if (tape === 12) {
    lines.push(main(h * 0.38));
    if (label.name)
      lines.push({ text: truncate(label.name, 28), size: h * 0.3, mono: false, bold: false });
  } else {
    lines.push(main(h * 0.26));
    if (label.name)
      lines.push({ text: truncate(label.name, 32), size: h * 0.2, mono: false, bold: true });
    const detail = [byAddress ? label.code : '', label.path].filter(Boolean).join(' · ');
    if (detail)
      lines.push({ text: truncate(detail, 48), size: h * 0.13, mono: false, bold: false });
  }
  const smallSize = (l: Line) => l.size * 0.55;
  const lineWidth = (l: Line) =>
    textWidth(l.text, l.size, l.mono) + (l.small ? textWidth(l.small, smallSize(l), l.mono) : 0);
  const block = lines.reduce((sum, l) => sum + l.size * 1.15, 0);
  let y = (h - block) / 2;
  const texts = lines
    .map((l) => {
      y += l.size;
      const font = l.mono
        ? 'IBM Plex Mono, Menlo, Consolas, monospace'
        : 'IBM Plex Sans, Arial, sans-serif';
      const body = l.small
        ? `<tspan font-size="${fmt(smallSize(l))}" font-weight="400">${escapeXml(l.small)}</tspan>${escapeXml(l.text)}`
        : escapeXml(l.text);
      const t = `<text x="${fmt(x0)}" y="${fmt(y)}" font-size="${fmt(l.size)}" font-family="${font}"${l.bold ? ' font-weight="700"' : ''} fill="#000">${body}</text>`;
      y += l.size * 0.15;
      return t;
    })
    .join('');
  const width = x0 + Math.max(...lines.map(lineWidth)) + gap;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}mm" height="${fmt(h)}mm" viewBox="0 0 ${fmt(width)} ${fmt(h)}">` +
    `<rect width="${fmt(width)}" height="${fmt(h)}" fill="#fff"/>` +
    `<path fill="#000" shape-rendering="crispEdges" d="${qrPath(m, QUIET * mod, QUIET * mod, mod)}"/>${texts}</svg>`
  );
}

/**
 * A unit's label: its name, and where it belongs (the home address) so whoever finds it lying
 * around knows where it goes. Without a home, the code takes the address's place.
 */
function unitLines(label: LabelData, tape: TapeWidth, h: number): Line[] {
  const home = label.address;
  const where = (size: number): Line => ({
    text: truncate(home || label.code, 24),
    size,
    mono: true,
    bold: true,
  });
  const name = (size: number, max: number): Line => ({
    text: truncate(label.name || label.code, max),
    size,
    mono: false,
    bold: true,
  });
  if (tape === 9) return [home ? where(h * 0.5) : name(h * 0.5, 22)];
  if (tape === 12) return [name(h * 0.34, 26), where(h * 0.3)];
  const detail = [label.path, home ? label.code : ''].filter(Boolean).join(' · ');
  return [
    name(h * 0.24, 30),
    where(h * 0.22),
    ...(detail ? [{ text: truncate(detail, 48), size: h * 0.13, mono: false, bold: false }] : []),
  ];
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * QR as DXF (R12, millimetres) for laser engraving or CAD: one closed rectangle per run of dark modules,
 * optionally inside a card outline with a mounting hole.
 */
export function qrDxf(
  text: string,
  opts: { moduleMm?: number; ecl?: ErrorCorrection; card?: boolean } = {},
): string {
  const m = qrMatrix(text, opts.ecl ?? 'Q');
  const mod = opts.moduleMm ?? 1;
  const size = m.size * mod;
  const out: string[] = [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$INSUNITS',
    '70',
    '4',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES',
  ];
  const rect = (x: number, y: number, w: number, h: number, layer: string) => {
    out.push('0', 'POLYLINE', '8', layer, '66', '1', '70', '1');
    for (const [px, py] of [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ] as const) {
      out.push('0', 'VERTEX', '8', layer, '10', fmt(px), '20', fmt(py));
    }
    out.push('0', 'SEQEND', '8', layer);
  };
  // DXF's y axis points up; QR rows go down.
  for (const r of runs(m)) rect(r.x * mod, size - (r.y + 1) * mod, r.w * mod, mod, 'QR');
  if (opts.card) {
    const margin = QUIET * mod + 2;
    rect(-margin, -margin, size + margin * 2, size + margin * 2 + 6, 'CUT');
    out.push(
      '0',
      'CIRCLE',
      '8',
      'CUT',
      '10',
      fmt(size / 2),
      '20',
      fmt(size + margin + 2),
      '40',
      '1.6',
    );
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return `${out.join('\r\n')}\r\n`;
}

/**
 * CSV for P-touch Editor's database merge (File › Database › Connect). Starts with a UTF-8 BOM
 * so Windows tools read ä/ö correctly. Columns: code, qr, name, path, type, then for places the
 * address ("Robolab-A-C"), the part of it above the place ("Robolab-A") and its short name ("C"),
 * so a template can print them in different sizes.
 */
export function labelsCsv(labels: LabelData[]): string {
  const q = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = [
    ['code', 'qr', 'name', 'path', 'type', 'address', 'parent', 'short'],
    ...labels.map((l) => [l.code, l.qr, l.name, l.path, l.type, l.address, l.parent, l.short]),
  ];
  return `\uFEFF${rows.map((r) => r.map(q).join(',')).join('\r\n')}\r\n`;
}
