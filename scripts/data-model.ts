// Draws the data model as one HTML page, docs/data-model.html, from the Drizzle schema.
// Columns and links come from the schema; where each table sits in a figure is laid out by hand here.
//   npm run docs:data-model
import { readFileSync, writeFileSync } from 'node:fs';
import { getTableName, is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from '../apps/server/src/db/schema.js';

interface Column {
  type: string;
  pk: boolean;
  notNull: boolean;
  unique: boolean;
  fk: string | null;
}

/** Table name to its columns, in schema order. */
const tables = new Map<string, Map<string, Column>>();
for (const table of Object.values(schema)) {
  if (!is(table, SQLiteTable)) continue;
  const config = getTableConfig(table);
  const fks = new Map(
    config.foreignKeys.flatMap((fk) => {
      const ref = fk.reference();
      return ref.columns.map((c) => [c.name, getTableName(ref.foreignTable)] as const);
    }),
  );
  const composite = new Set(config.primaryKeys.flatMap((k) => k.columns.map((c) => c.name)));
  tables.set(
    config.name,
    new Map(
      config.columns.map((c) => [
        c.name,
        {
          type: c.getSQLType(),
          pk: c.primary || composite.has(c.name),
          notNull: c.notNull,
          unique: c.isUnique,
          fk: fks.get(c.name) ?? null,
        },
      ]),
    ),
  );
}

function column(table: string, name: string): Column {
  const found = tables.get(table)?.get(name);
  if (!found) throw new Error(`The figure draws ${table}.${name}, which the schema no longer has.`);
  return found;
}

const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

const BOX_WIDTH = 210;
const ROW = 18;
const HEADER = 26;

type EdgeKind = 'fk' | 'bulk' | 'unit' | 'soft';
type Point = readonly [number, number];
type Accent = 'bulk' | 'unit' | 'place';

/** Foreign keys that have an arrow, as "table.column". */
const drawn = new Set<string>();

class Figure {
  private readonly boxes = new Map<string, { y: number; cols: string[] }>();
  private readonly shapes: string[] = [];
  private readonly edges: string[] = [];
  private readonly labels: string[] = [];

  /** `loose`: id columns with no database constraint, marked ~ . */
  box(table: string, x: number, y: number, cols: string[], accent?: Accent, loose: string[] = []) {
    this.boxes.set(table, { y, cols });
    const height = HEADER + ROW * cols.length;
    const head = accent ? `hd-${accent}` : 'hd';
    this.shapes.push(
      `<rect class="box" x="${x}" y="${y}" width="${BOX_WIDTH}" height="${height}" rx="4"/>`,
      `<path class="${head}" d="M${x} ${y + HEADER}V${y + 4}a4 4 0 0 1 4-4H${x + BOX_WIDTH - 4}a4 4 0 0 1 4 4V${y + HEADER}Z"/>`,
      `<text class="tn" x="${x + 10}" y="${y + 18}">${table}</text>`,
    );
    cols.forEach((name, i) => {
      const c = column(table, name);
      const tag = c.fk ? 'FK' : c.pk ? 'PK' : c.unique ? 'UQ' : loose.includes(name) ? '~' : '';
      const rowY = y + HEADER + ROW * i + 13;
      const strong = tag === 'FK' || tag === '~' ? ' fk' : '';
      this.shapes.push(`<text class="col${strong}" x="${x + 10}" y="${rowY}">${name}</text>`);
      if (tag)
        this.shapes.push(
          `<text class="tg" x="${x + BOX_WIDTH - 8}" y="${rowY}" text-anchor="end">${tag}</text>`,
        );
    });
  }

  /** The vertical middle of a column's row. */
  row(table: string, name: string): number {
    const box = this.boxes.get(table);
    const i = box?.cols.indexOf(name) ?? -1;
    if (!box || i < 0) throw new Error(`${table}.${name} isn't in this figure.`);
    return box.y + HEADER + ROW * i + 9;
  }

  /** A line ending in an arrow; `fk` says which foreign key it stands for. */
  line(points: Point[], opts: { fk?: string; label?: string; at?: Point; kind?: EdgeKind } = {}) {
    const kind = opts.kind ?? 'fk';
    const d = `M${points.map(([x, y]) => `${x} ${y}`).join(' L')}`;
    this.edges.push(`<path class="e e-${kind}" d="${d}" marker-end="url(#a-${kind})"/>`);
    if (opts.fk) drawn.add(opts.fk);
    if (opts.label && opts.at) {
      const [x, y] = opts.at;
      const width = Math.round(opts.label.length * 5.9 + 8);
      this.labels.push(
        `<rect class="lb" x="${Math.round(x - width / 2)}" y="${y - 9}" width="${width}" height="14"/>`,
        `<text class="lt lt-${kind}" x="${x}" y="${y + 2}" text-anchor="middle">${opts.label}</text>`,
      );
    }
  }

  svg(width: number, height: number, minWidth: number, label: string): string {
    const markers = (['fk', 'bulk', 'unit', 'soft'] as const)
      .map(
        (k) =>
          `<marker id="a-${k}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path class="m-${k}" d="M0 0 8 4 0 8Z"/></marker>`,
      )
      .join('');
    return `<div class="scroll"><svg role="img" aria-label="${escapeHtml(label)}" viewBox="0 0 ${width} ${height}" style="min-width:${minWidth}px"><defs>${markers}</defs>${[...this.edges, ...this.shapes, ...this.labels].join('')}</svg></div>`;
  }
}

/** Items, places, and the two ways stock connects them. */
function coreFigure(): string {
  const f = new Figure();
  const [left, items, stock, places] = [50, 340, 650, 960] as const;
  const placesRight = places + BOX_WIDTH;
  f.box(
    'categories',
    left,
    30,
    ['id', 'parent_id', 'name', 'path', 'attribute_template'],
    undefined,
    ['parent_id'],
  );
  f.box('part_identifiers', left, 170, ['id', 'part_id', 'kind', 'value']);
  f.box('part_tags', left, 300, ['part_id', 'tag_id']);
  f.box('tags', left, 400, ['id', 'name', 'color']);
  f.box('parts', items, 30, [
    'id',
    'code',
    'name',
    'category_id',
    'kind',
    'tracking',
    'cut',
    'status',
    'attributes',
    'min_stock',
  ]);
  f.box(
    'stock_movements',
    items,
    300,
    ['id', 'part_id', 'lot_id', 'from_location_id', 'to_location_id', 'reason', 'delta'],
    undefined,
    ['lot_id', 'from_location_id', 'to_location_id'],
  );
  f.box(
    'stock_lots',
    stock,
    30,
    ['id', 'part_id', 'location_id', 'origin_location_id', 'mode', 'quantity', 'level', 'pieces'],
    'bulk',
  );
  f.box(
    'units',
    stock,
    240,
    [
      'id',
      'code',
      'part_id',
      'location_id',
      'home_location_id',
      'status',
      'serial_no',
      'purchase_date',
      'purchase_value_cents',
      'cost_center',
      'useful_life_years',
    ],
    'unit',
  );
  f.box(
    'unit_events',
    stock,
    520,
    ['id', 'unit_id', 'kind', 'text', 'value', 'from_location_id', 'to_location_id'],
    undefined,
    ['from_location_id', 'to_location_id'],
  );
  f.box(
    'locations',
    places,
    30,
    ['id', 'code', 'parent_id', 'type_id', 'kind', 'name', 'path', 'dismantled_at', 'archived_at'],
    'place',
    ['parent_id'],
  );
  f.box('location_types', places, 270, [
    'id',
    'key',
    'movable',
    'workstation',
    'build',
    'stay_days',
  ]);
  f.box('loans', places, 450, [
    'id',
    'unit_id',
    'location_id',
    'from_location_id',
    'responsible_user_id',
    'description',
    'due_at',
    'returned_at',
  ]);
  f.box(
    'location_moves',
    places,
    650,
    ['id', 'location_id', 'from_parent_id', 'to_parent_id'],
    undefined,
    ['from_parent_id', 'to_parent_id'],
  );

  // Into the item, from the left.
  let y = f.row('parts', 'category_id');
  let to = f.row('categories', 'id');
  f.line(
    [
      [items, y],
      [300, y],
      [300, to],
      [left + BOX_WIDTH, to],
    ],
    { fk: 'parts.category_id', label: 'in category', at: [300, 100] },
  );
  y = f.row('part_identifiers', 'part_id');
  to = f.row('parts', 'cut');
  f.line(
    [
      [left + BOX_WIDTH, y],
      [285, y],
      [285, to],
      [items, to],
    ],
    { fk: 'part_identifiers.part_id' },
  );
  y = f.row('part_tags', 'part_id');
  to = f.row('parts', 'min_stock');
  f.line(
    [
      [left + BOX_WIDTH, y],
      [315, y],
      [315, to],
      [items, to],
    ],
    { fk: 'part_tags.part_id' },
  );
  f.line(
    [
      [left + 105, 362],
      [left + 105, 400],
    ],
    { fk: 'part_tags.tag_id' },
  );

  // The two trees: no database constraint on parent_id.
  y = f.row('categories', 'parent_id');
  to = f.row('categories', 'id');
  f.line(
    [
      [left, y],
      [28, y],
      [28, to],
      [left, to],
    ],
    { kind: 'soft', label: 'tree', at: [28, y - 22] },
  );
  y = f.row('locations', 'parent_id');
  to = f.row('locations', 'id');
  f.line(
    [
      [placesRight, y],
      [placesRight + 22, y],
      [placesRight + 22, to],
      [placesRight, to],
    ],
    { kind: 'soft', label: 'tree', at: [placesRight + 22, y - 22] },
  );

  // Stock history.
  f.line(
    [
      [items + 105, 300],
      [items + 105, 236],
    ],
    { fk: 'stock_movements.part_id', label: 'history of', at: [items + 105, 268] },
  );
  y = f.row('stock_movements', 'lot_id');
  to = f.row('stock_lots', 'pieces');
  f.line(
    [
      [items + BOX_WIDTH, y],
      [620, y],
      [620, to],
      [stock, to],
    ],
    { kind: 'soft', label: 'snapshot of', at: [604, 345] },
  );

  // Bulk or individual: the two ways an item holds stock.
  y = f.row('stock_lots', 'part_id');
  to = f.row('parts', 'tracking') - 9;
  f.line(
    [
      [stock, y],
      [595, y],
      [595, to],
      [items + BOX_WIDTH, to],
    ],
    { fk: 'stock_lots.part_id', kind: 'bulk', label: 'bulk', at: [612, y - 9] },
  );
  y = f.row('units', 'part_id');
  to = f.row('parts', 'tracking') + 9;
  f.line(
    [
      [stock, y],
      [575, y],
      [575, to],
      [items + BOX_WIDTH, to],
    ],
    { fk: 'units.part_id', kind: 'unit', label: 'individual', at: [575, 262] },
  );

  // Where stock is.
  y = f.row('stock_lots', 'location_id');
  f.line(
    [
      [stock + BOX_WIDTH, y],
      [places, y],
    ],
    { fk: 'stock_lots.location_id', kind: 'bulk', label: 'lies in', at: [905, y - 8] },
  );
  y = f.row('stock_lots', 'origin_location_id');
  f.line(
    [
      [stock + BOX_WIDTH, y],
      [places, y],
    ],
    { fk: 'stock_lots.origin_location_id', kind: 'bulk', label: 'returns to', at: [905, y + 14] },
  );
  y = f.row('units', 'location_id');
  to = f.row('locations', 'name');
  f.line(
    [
      [stock + BOX_WIDTH, y],
      [895, y],
      [895, to],
      [places, to],
    ],
    { fk: 'units.location_id', kind: 'unit', label: 'is at', at: [895, y - 14] },
  );
  y = f.row('units', 'home_location_id');
  to = f.row('locations', 'dismantled_at');
  f.line(
    [
      [stock + BOX_WIDTH, y],
      [925, y],
      [925, to],
      [places, to],
    ],
    { fk: 'units.home_location_id', kind: 'unit', label: 'belongs at', at: [925, y + 14] },
  );

  // Units' log and loans; a place's type, loans and moves.
  f.line(
    [
      [stock + 105, 520],
      [stock + 105, 464],
    ],
    { fk: 'unit_events.unit_id', label: 'log of', at: [stock + 105, 492] },
  );
  y = f.row('loans', 'unit_id');
  to = f.row('units', 'useful_life_years');
  f.line(
    [
      [places, y],
      [905, y],
      [905, to],
      [stock + BOX_WIDTH, to],
    ],
    { fk: 'loans.unit_id', label: 'lends', at: [905, y + 14] },
  );
  f.line(
    [
      [places + 105, 270],
      [places + 105, 218],
    ],
    { fk: 'locations.type_id', label: 'has type', at: [places + 105, 243] },
  );
  y = f.row('loans', 'location_id');
  to = f.row('locations', 'kind');
  f.line(
    [
      [placesRight, y],
      [placesRight + 22, y],
      [placesRight + 22, to],
      [placesRight, to],
    ],
    { fk: 'loans.location_id' },
  );
  y = f.row('loans', 'from_location_id');
  to = f.row('locations', 'path');
  f.line(
    [
      [placesRight, y],
      [placesRight + 36, y],
      [placesRight + 36, to],
      [placesRight, to],
    ],
    { fk: 'loans.from_location_id' },
  );
  y = f.row('location_moves', 'location_id');
  to = f.row('locations', 'name') + 45;
  f.line(
    [
      [placesRight, y],
      [placesRight + 50, y],
      [placesRight + 50, to],
      [placesRight, to],
    ],
    { fk: 'location_moves.location_id' },
  );

  return f.svg(
    1240,
    770,
    1100,
    'The core tables. An item (parts) holds its stock either as stock_lots or as units, chosen by parts.tracking. Lots and units both point at locations, which form a tree.',
  );
}

/** Files and maps, and the tables that name their owner by type and id. */
function attachedFigure(): string {
  const f = new Figure();
  f.box(
    'attachments',
    30,
    40,
    ['id', 'file_id', 'url', 'owner_type', 'owner_id', 'kind'],
    undefined,
    ['owner_id'],
  );
  f.box(
    'reports',
    30,
    230,
    ['id', 'owner_type', 'owner_id', 'kind', 'note', 'resolved_at'],
    undefined,
    ['owner_id'],
  );
  f.box('files', 430, 40, ['id', 'sha256', 'filename', 'mime', 'size']);
  f.box('map_drawings', 800, 40, ['id', 'name', 'kind', 'file_id']);
  f.box('map_usages', 800, 175, ['id', 'location_id', 'drawing_id', 'kind']);
  f.box('map_links', 800, 315, ['id', 'usage_id', 'element_key', 'target_id']);
  f.box('parts', 430, 190, []);
  f.box('units', 430, 250, [], 'unit');
  f.box('locations', 430, 310, [], 'place');

  let y = f.row('attachments', 'file_id');
  f.line(
    [
      [240, y],
      [430, y],
    ],
    { fk: 'attachments.file_id', label: 'file', at: [335, y - 8] },
  );
  y = f.row('map_drawings', 'file_id');
  f.line(
    [
      [800, y],
      [640, y],
    ],
    { fk: 'map_drawings.file_id', label: 'drawn in', at: [720, y - 8] },
  );
  f.line(
    [
      [905, 175],
      [905, 138],
    ],
    { fk: 'map_usages.drawing_id', label: 'uses', at: [905, 158] },
  );
  f.line(
    [
      [905, 315],
      [905, 273],
    ],
    { fk: 'map_links.usage_id', label: 'of', at: [905, 297] },
  );
  y = f.row('map_usages', 'location_id');
  f.line(
    [
      [800, y],
      [720, y],
      [720, 322],
      [640, 322],
    ],
    { fk: 'map_usages.location_id', label: 'shown on', at: [720, y + 40] },
  );
  y = f.row('map_links', 'target_id');
  f.line(
    [
      [800, y],
      [690, y],
      [690, 330],
      [640, 330],
    ],
    { fk: 'map_links.target_id', label: 'shape stands for', at: [700, y + 16] },
  );

  y = f.row('attachments', 'owner_id');
  f.line(
    [
      [240, y],
      [365, y],
      [365, 198],
      [430, 198],
    ],
    { kind: 'soft', label: 'part or place', at: [300, y - 8] },
  );
  f.line(
    [
      [365, 198],
      [365, 330],
      [430, 330],
    ],
    { kind: 'soft' },
  );
  y = f.row('reports', 'owner_id');
  f.line(
    [
      [240, y],
      [405, y],
      [405, 208],
      [430, 208],
    ],
    { kind: 'soft', label: 'part, unit or place', at: [300, y - 8] },
  );
  f.line(
    [
      [405, 263],
      [430, 263],
    ],
    { kind: 'soft' },
  );
  f.line(
    [
      [405, 318],
      [430, 318],
    ],
    { kind: 'soft' },
  );

  return f.svg(
    1030,
    430,
    900,
    'Shared and polymorphic tables. Attachments and reports name their owner by type and id with no database foreign key. Map drawings use one file and can serve many places.',
  );
}

/** Tables by subject, each with what it's for, for the reference at the end of the page. */
const GROUPS: [string, [string, string][]][] = [
  [
    'Items',
    [
      ['parts', 'An item: what a thing is. Holds stock as lots or as units.'],
      ['categories', 'Tree of categories. Fields inherit down the tree.'],
      ['part_identifiers', 'Order numbers, EANs and such, for the item, not per unit.'],
      ['tags', 'Tag names.'],
      ['part_tags', 'Which items have which tags.'],
    ],
  ],
  [
    'Stock and units',
    [
      ['stock_lots', 'An amount of a bulk item in one place.'],
      ['stock_movements', 'Every change to a lot. Undo reads this.'],
      ['units', 'One tracked tool or device, with its finance fields.'],
      ['unit_events', "A unit's log: moves, notes, firmware, loans."],
      ['loans', 'A unit or a container out of the lab.'],
      ['reports', 'Problem reports, from anyone.'],
    ],
  ],
  [
    'Places',
    [
      ['locations', 'The place tree, carry lists and builds included.'],
      ['location_types', 'Room, shelf, box… and what each type allows.'],
      ['location_moves', 'When a place moved to another parent.'],
      ['codes', 'Every code ever used, across places, items and units.'],
    ],
  ],
  [
    'Maps and files',
    [
      ['files', 'Stored files, one per content hash.'],
      ['attachments', 'Files or links on an item or a place.'],
      ['map_drawings', 'An SVG or .glb, reusable for many places.'],
      ['map_usages', 'A place shown with a drawing.'],
      ['map_links', 'Which shape stands for which place.'],
    ],
  ],
  [
    'People and system',
    [
      ['users', "Accounts, including each person's default location."],
      ['api_tokens', 'API tokens and web sessions.'],
      ['audit_log', 'Other edits, as a generic change log.'],
      ['import_mappings', 'Saved spreadsheet column mappings.'],
      ['settings', 'Lab-wide settings.'],
    ],
  ],
];

function reference(): string {
  const listed = new Set(GROUPS.flatMap(([, list]) => list.map(([name]) => name)));
  const missing = [...tables.keys()].filter((t) => !listed.has(t));
  const gone = [...listed].filter((t) => !tables.has(t));
  if (missing.length || gone.length)
    throw new Error(`Update GROUPS. Not listed: ${missing.join(', ')}. Gone: ${gone.join(', ')}.`);
  return GROUPS.map(([group, list]) => {
    const cards = list.map(([name, purpose]) => {
      const rows = [...tables.get(name)!].map(([col, c]) => {
        const key = c.fk ? `FK → ${c.fk}` : c.pk ? 'PK' : c.unique ? 'UQ' : '';
        const optional = c.notNull || c.pk ? '' : '<span class="nl">?</span>';
        return `<tr><td><code>${col}</code>${optional}</td><td class="ty">${c.type}</td><td class="k">${key}</td></tr>`;
      });
      return `<section class="card" id="t-${name}"><h4>${name}</h4><p>${escapeHtml(purpose)}</p><table>${rows.join('')}</table></section>`;
    });
    return `<h3>${group}</h3><div class="cards">${cards.join('')}</div>`;
  }).join('');
}

function whoDidWhat(): string {
  return [...tables]
    .flatMap(([table, cols]) => {
      const names = [...cols].filter(([, c]) => c.fk === 'users').map(([n]) => `<code>${n}</code>`);
      return names.length
        ? [`<tr><td><code>${table}</code></td><td>${names.join(', ')}</td></tr>`]
        : [];
    })
    .join('');
}

const figures = { core: coreFigure(), attached: attachedFigure() };

// users.home_location_id is explained in the page's text, since users aren't in the figures.
const undrawn = [...tables].flatMap(([table, cols]) =>
  [...cols]
    .filter(([name, c]) => c.fk && c.fk !== 'users' && !drawn.has(`${table}.${name}`))
    .map(([name, c]) => `${table}.${name} → ${c.fk}`)
    .filter((fk) => fk !== 'users.home_location_id → locations'),
);
if (undrawn.length) throw new Error(`Foreign keys with no arrow: ${undrawn.join(', ')}.`);

const root = new URL('../', import.meta.url);
const journal = JSON.parse(
  readFileSync(new URL('apps/server/drizzle/meta/_journal.json', root), 'utf8'),
) as { entries: { tag: string }[] };
const page = readFileSync(new URL('scripts/data-model.template.html', root), 'utf8')
  .replace('@@F1@@', figures.core)
  .replace('@@F2@@', figures.attached)
  .replace('@@WHO@@', whoDidWhat())
  .replace('@@REF@@', reference())
  .replace('@@N@@', String(tables.size))
  .replace('@@MIGRATION@@', journal.entries.at(-1)!.tag);
writeFileSync(new URL('docs/data-model.html', root), page);
console.log(`docs/data-model.html: ${tables.size} tables, ${drawn.size} arrows.`);
