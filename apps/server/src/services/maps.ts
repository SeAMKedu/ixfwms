import { readFile } from 'node:fs/promises';
import {
  codeFromElementId,
  codeFromObjectName,
  glbNodeNames,
  svgElementIds,
  type MapCheck,
  type MapDrawingInfo,
  type MapKind,
  type MapLayer,
  type MapLink,
} from '@ixfwms/domain';
import { and, eq, inArray, like } from 'drizzle-orm';
import type { Db, Executor } from '../db/client.js';
import { locations, mapDrawings, mapLinks, mapUsages } from '../db/schema.js';
import { invalid, notFound } from '../lib/errors.js';
import { newId, nowIso } from '../lib/ids.js';
import { audit, requireScope, type Actor } from './context.js';
import type { FileService } from './files.js';
import type { LocationRow, LocationService } from './locations.js';

const MAX_SVG_BYTES = 10 * 1024 * 1024;
const MAX_MODEL_BYTES = 100 * 1024 * 1024;
const SHAPES = 'rect|path|circle|ellipse|polygon|polyline|line|g|use|image|text';

type DrawingRow = typeof mapDrawings.$inferSelect;
type UsageRow = typeof mapUsages.$inferSelect;

/**
 * Gives every shape in an SVG an id, so it can be linked to a place and the link survives edits.
 * Shapes that already have one keep it (Inkscape gives ids to everything anyway).
 */
function addMissingSvgIds(svg: string): { svg: string; added: number } {
  const taken = new Set(svgElementIds(svg));
  let n = 0;
  let added = 0;
  const out = svg.replace(
    new RegExp(`<(${SHAPES})(?=[\\s/>])([^>]*)>`, 'g'),
    (tag: string, name: string, attrs: string) => {
      if (/\sid\s*=/.test(attrs)) return tag;
      let id: string;
      do id = `ixf-${++n}`;
      while (taken.has(id));
      added++;
      return `<${name} id="${id}"${attrs}>`;
    },
  );
  return { svg: out, added };
}

/**
 * Lab maps. A drawing (SVG or .glb) lives in a shared library and can be used by many places;
 * each use links shapes to that place's own sub-places, by clicking in the app or by naming a
 * shape loc-<code> in the drawing tool. Replacing a drawing updates every place that uses it.
 */
export class MapService {
  private readonly keyCache = new Map<string, string[]>();

  constructor(
    private readonly db: Db,
    private readonly locations: LocationService,
    private readonly files: FileService,
  ) {}

  // --- library ---------------------------------------------------------------------------------

  async drawings(): Promise<MapDrawingInfo[]> {
    const rows = await this.db.select().from(mapDrawings).all();
    const usages = await this.db.select().from(mapUsages).all();
    const out: MapDrawingInfo[] = [];
    for (const d of rows) {
      const uses: MapDrawingInfo['usages'] = [];
      for (const u of usages.filter((x) => x.drawingId === d.id)) {
        const loc = await this.locations.resolve(u.locationId);
        const check = await this.checkUsage(loc, u, d);
        uses.push({
          location: await this.locations.summarize(this.db, loc),
          linked: check.links.length,
          broken: check.broken.length,
        });
      }
      out.push({
        id: d.id,
        name: d.name,
        kind: d.kind,
        href: await this.href(d.fileId),
        updatedAt: d.updatedAt,
        usages: uses,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Adds an uploaded SVG or .glb to the library. */
  async createDrawing(
    fileId: string,
    name: string | null,
    actor: Actor | null,
  ): Promise<MapDrawingInfo> {
    const who = requireScope(actor, 'inventory');
    const prepared = await this.prepare(fileId, who);
    const row = {
      id: newId(),
      name: name ?? prepared.filename,
      kind: prepared.kind,
      fileId: prepared.fileId,
      createdBy: who.userId,
    };
    await this.db.insert(mapDrawings).values(row);
    await audit(this.db, who, 'map-drawing', 'map', row.id, { name: row.name });
    const created = await this.drawing(row.id);
    return {
      id: created.id,
      name: created.name,
      kind: created.kind,
      href: await this.href(created.fileId),
      updatedAt: created.updatedAt,
      usages: [],
    };
  }

  /** New version of a drawing: every place using it gets it. Returns each place's sanity check. */
  async replaceDrawing(
    drawingId: string,
    fileId: string,
    actor: Actor | null,
  ): Promise<{ location: string; check: MapCheck }[]> {
    const who = requireScope(actor, 'inventory');
    const drawing = await this.drawing(drawingId);
    const prepared = await this.prepare(fileId, who);
    if (prepared.kind !== drawing.kind) {
      throw invalid(
        drawing.kind === 'svg_2d'
          ? 'This map is an SVG drawing; upload an .svg'
          : 'This map is a 3D model; upload a .glb',
      );
    }
    await this.db
      .update(mapDrawings)
      .set({ fileId: prepared.fileId, updatedAt: nowIso() })
      .where(eq(mapDrawings.id, drawing.id));
    await audit(this.db, who, 'map-replaced', 'map', drawing.id, { fileId: prepared.fileId });
    const updated = await this.drawing(drawingId);
    const out: { location: string; check: MapCheck }[] = [];
    for (const u of await this.usagesOf(drawing.id)) {
      const loc = await this.locations.resolve(u.locationId);
      out.push({ location: loc.code, check: await this.checkUsage(loc, u, updated) });
    }
    return out;
  }

  async renameDrawing(drawingId: string, name: string, actor: Actor | null): Promise<void> {
    const who = requireScope(actor, 'inventory');
    await this.drawing(drawingId);
    await this.db
      .update(mapDrawings)
      .set({ name, updatedAt: nowIso() })
      .where(eq(mapDrawings.id, drawingId));
    await audit(this.db, who, 'map-renamed', 'map', drawingId, { name });
  }

  /** Removes a drawing from the library; only when no place uses it any more. */
  async deleteDrawing(drawingId: string, actor: Actor | null): Promise<void> {
    const who = requireScope(actor, 'inventory');
    await this.drawing(drawingId);
    const used = await this.usagesOf(drawingId);
    if (used.length) {
      throw invalid(`Still used by ${used.length} place(s); remove it from them first`);
    }
    await this.db.delete(mapDrawings).where(eq(mapDrawings.id, drawingId));
    await audit(this.db, who, 'map-deleted', 'map', drawingId);
  }

  // --- places ----------------------------------------------------------------------------------

  /**
   * Uploads a map for one place. If the place's current drawing is its own (not shared), this is a
   * new version of it and the links stay; otherwise the place gets a new drawing of its own.
   */
  async setMap(ref: string, fileId: string, actor: Actor | null): Promise<MapCheck> {
    const who = requireScope(actor, 'inventory');
    const loc = await this.locations.resolve(ref);
    const prepared = await this.prepare(fileId, who);
    const usage = await this.usage(loc.id, prepared.kind);
    if (usage && (await this.usagesOf(usage.drawingId)).length === 1) {
      await this.db
        .update(mapDrawings)
        .set({ fileId: prepared.fileId, updatedAt: nowIso() })
        .where(eq(mapDrawings.id, usage.drawingId));
      await audit(this.db, who, 'map-replaced', 'location', loc.id, { fileId: prepared.fileId });
      return this.check(loc.code, prepared.kind);
    }
    const drawing = {
      id: newId(),
      name: `${loc.name}: ${prepared.filename}`,
      kind: prepared.kind,
      fileId: prepared.fileId,
      createdBy: who.userId,
    };
    await this.db.insert(mapDrawings).values(drawing);
    await this.use(loc, drawing.id, prepared.kind, who);
    return this.check(loc.code, prepared.kind);
  }

  /** Shows a library drawing for this place, optionally copying the links of another place using it. */
  async attach(
    ref: string,
    drawingId: string,
    copyFrom: string | null,
    actor: Actor | null,
  ): Promise<MapCheck> {
    const who = requireScope(actor, 'inventory');
    const loc = await this.locations.resolve(ref);
    const drawing = await this.drawing(drawingId);
    await this.use(loc, drawing.id, drawing.kind, who);
    if (copyFrom) return this.copyLinks(loc.code, drawing.kind, copyFrom, who);
    return this.check(loc.code, drawing.kind);
  }

  /** Stops showing a map for this place. The drawing stays in the library. */
  async removeMap(ref: string, kind: MapKind, actor: Actor | null): Promise<void> {
    const who = requireScope(actor, 'inventory');
    const loc = await this.locations.resolve(ref);
    await this.db
      .delete(mapUsages)
      .where(and(eq(mapUsages.locationId, loc.id), eq(mapUsages.kind, kind)));
    await audit(this.db, who, 'map-removed', 'location', loc.id, { kind });
  }

  /** Links a shape to a sub-place, or unlinks it (`targetRef` null). Each sub-place has one shape. */
  async setLink(
    ref: string,
    kind: MapKind,
    elementKey: string,
    targetRef: string | null,
    actor: Actor | null,
  ): Promise<MapCheck> {
    const who = requireScope(actor, 'inventory');
    const loc = await this.locations.resolve(ref);
    const usage = await this.usage(loc.id, kind);
    if (!usage) throw notFound('Map of', loc.code);
    await this.db.transaction(async (tx) => {
      await tx
        .delete(mapLinks)
        .where(and(eq(mapLinks.usageId, usage.id), eq(mapLinks.elementKey, elementKey)));
      if (!targetRef) return;
      const target = await this.locations.resolve(targetRef, tx);
      if (target.id === loc.id || !target.path.startsWith(loc.path)) {
        throw invalid(`${target.name} isn't inside ${loc.name}`);
      }
      await tx
        .delete(mapLinks)
        .where(and(eq(mapLinks.usageId, usage.id), eq(mapLinks.targetId, target.id)));
      await tx
        .insert(mapLinks)
        .values({ id: newId(), usageId: usage.id, elementKey, targetId: target.id });
    });
    await audit(this.db, who, 'map-link', 'location', loc.id, {
      kind,
      elementKey,
      target: targetRef,
    });
    return this.check(loc.code, kind);
  }

  /**
   * "Link like another place": both places use the same drawing; each of the other place's links
   * is repeated for the sub-place here with the same name path (e.g. "Shelf 3"), or failing that,
   * the one in the same position.
   */
  async copyLinks(
    ref: string,
    kind: MapKind,
    fromRef: string,
    actor: Actor | null,
  ): Promise<MapCheck> {
    const who = requireScope(actor, 'inventory');
    const loc = await this.locations.resolve(ref);
    const from = await this.locations.resolve(fromRef);
    const target = await this.usage(loc.id, kind);
    const source = await this.usage(from.id, kind);
    if (!target || !source) throw invalid('Both places need a map first');
    if (target.drawingId !== source.drawingId) {
      throw invalid(`${from.name} uses a different drawing`);
    }
    const sourceTree = await this.subtree(from);
    const targetTree = await this.subtree(loc);
    const used = new Set<string>();
    const pairs = new Map<string, string>();
    const key = (names: string[]) => names.join('/').toLowerCase();
    for (const src of sourceTree) {
      const match =
        targetTree.find((n) => !used.has(n.id) && key(n.names) === key(src.names)) ??
        targetTree.find(
          (n) => !used.has(n.id) && n.positions.join('/') === src.positions.join('/'),
        );
      if (!match) continue;
      used.add(match.id);
      pairs.set(src.id, match.id);
    }
    const { targets } = await this.resolveLinks(from, source, await this.drawing(source.drawingId));
    await this.db.transaction((tx) => this.repeatLinks(tx, targets, target, pairs));
    await audit(this.db, who, 'map-links-copied', 'location', loc.id, { from: from.id, kind });
    return this.check(loc.code, kind);
  }

  /**
   * For a duplicated place: every copy gets the maps its original had, with the links pointing at
   * the matching copies. `pairs` maps original location ids to copy ids.
   */
  async copyMapsFor(tx: Executor, pairs: Map<string, string>): Promise<void> {
    const originals = await tx
      .select()
      .from(mapUsages)
      .where(inArray(mapUsages.locationId, [...pairs.keys()]))
      .all();
    for (const usage of originals) {
      const original = await this.locations.resolve(usage.locationId, tx);
      const { targets } = await this.resolveLinks(
        original,
        usage,
        await this.drawing(usage.drawingId, tx),
        tx,
      );
      const copy = {
        id: newId(),
        locationId: pairs.get(usage.locationId)!,
        drawingId: usage.drawingId,
        kind: usage.kind,
      };
      await tx.insert(mapUsages).values(copy);
      await this.repeatLinks(tx, targets, copy, pairs);
    }
  }

  async check(ref: string, kind: MapKind): Promise<MapCheck> {
    const loc = await this.locations.resolve(ref);
    const usage = await this.usage(loc.id, kind);
    if (!usage) throw notFound('Map of', loc.code);
    return this.checkUsage(loc, usage, await this.drawing(usage.drawingId));
  }

  /**
   * "Show me where": the drawings on the way from the top level down to this place (its own
   * included), each with the path to highlight and which place every linked shape stands for.
   */
  async layers(ref: string): Promise<MapLayer[]> {
    const loc = await this.locations.resolve(ref);
    const path = await this.locations.pathOf(loc);
    const usages = await this.db
      .select()
      .from(mapUsages)
      .where(
        inArray(
          mapUsages.locationId,
          path.map((p) => p.id),
        ),
      )
      .all();
    // Shapes standing for an overdue temporary place, or for something that holds one.
    const late = new Set(
      (await this.locations.overdue()).flatMap((o) => o.path.map((p) => p.code)),
    );
    const layers: MapLayer[] = [];
    for (const [i, place] of path.entries()) {
      // 3D first when a place has both: it's usually the richer view of the same room.
      for (const usage of usages
        .filter((u) => u.locationId === place.id)
        .sort((a, b) => a.kind.localeCompare(b.kind))) {
        const drawing = await this.drawing(usage.drawingId);
        const check = await this.checkUsage(await this.locations.resolve(place.id), usage, drawing);
        layers.push({
          location: place,
          kind: usage.kind,
          drawingId: drawing.id,
          href: await this.href(drawing.fileId),
          highlight: path.slice(i + 1).map((p) => p.code),
          links: Object.fromEntries(check.links.map((l) => [l.elementKey, l.code])),
          attention: check.links.map((l) => l.code).filter((c) => late.has(c)),
        });
      }
    }
    return layers;
  }

  /**
   * A starting point for drawing a map: one labelled box per sub-place, already carrying the right
   * ids, laid out in a grid. Move and reshape them in Inkscape to match the room, then upload.
   */
  async starterSvg(ref: string): Promise<string> {
    const loc = await this.locations.resolve(ref);
    const children = await this.locations.children(loc.id);
    const cols = Math.max(1, Math.ceil(Math.sqrt(children.length)));
    const [w, h, gap, pad] = [180, 110, 30, 40];
    const rows = Math.max(1, Math.ceil(children.length / cols));
    const width = pad * 2 + cols * w + (cols - 1) * gap;
    const height = pad * 2 + 40 + rows * h + (rows - 1) * gap;
    const esc = (s: string) =>
      s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const boxes = children
      .map((c, i) => {
        const x = pad + (i % cols) * (w + gap);
        const y = pad + 40 + Math.floor(i / cols) * (h + gap);
        return (
          `<g id="loc:${c.code}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#f6f8f8" stroke="#586672" stroke-width="2"/>` +
          `<text x="${x + 12}" y="${y + 30}" font-family="sans-serif" font-size="16" fill="#15202a">${esc(c.name)}</text>` +
          `<text x="${x + 12}" y="${y + 54}" font-family="monospace" font-size="13" fill="#586672">${c.code}</text></g>`
        );
      })
      .join('\n  ');
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n` +
      `  <!-- ixfwms starter map for ${esc(loc.name)} (${loc.code}). Rearrange freely; shapes can also be linked by clicking them in ixfwms. -->\n` +
      `  <rect width="${width}" height="${height}" fill="#ffffff"/>\n` +
      `  <text x="${pad}" y="${pad + 8}" font-family="sans-serif" font-size="22" font-weight="bold" fill="#15202a">${esc(loc.name)}</text>\n` +
      `  ${boxes}\n</svg>\n`
    );
  }

  // --- internals -------------------------------------------------------------------------------

  private async use(loc: LocationRow, drawingId: string, kind: MapKind, who: Actor) {
    const existing = await this.usage(loc.id, kind);
    if (existing?.drawingId === drawingId) return;
    // A place shows one drawing per kind; its old links go with the old one.
    if (existing) await this.db.delete(mapUsages).where(eq(mapUsages.id, existing.id));
    await this.db.insert(mapUsages).values({ id: newId(), locationId: loc.id, drawingId, kind });
    await audit(this.db, who, 'map', 'location', loc.id, { drawingId, kind });
  }

  /**
   * Replaces `target`'s links with `links` (another place's, name links included), pointed at the
   * places `pairs` maps them to. Name links become click-made ones, since the copies have new codes.
   */
  private async repeatLinks(
    tx: Executor,
    links: { elementKey: string; targetId: string }[],
    target: Pick<UsageRow, 'id'>,
    pairs: Map<string, string>,
  ) {
    await tx.delete(mapLinks).where(eq(mapLinks.usageId, target.id));
    for (const link of links) {
      const targetId = pairs.get(link.targetId);
      if (!targetId) continue;
      await tx
        .insert(mapLinks)
        .values({ id: newId(), usageId: target.id, elementKey: link.elementKey, targetId });
    }
  }

  private async usage(locationId: string, kind: MapKind): Promise<UsageRow | undefined> {
    return this.db
      .select()
      .from(mapUsages)
      .where(and(eq(mapUsages.locationId, locationId), eq(mapUsages.kind, kind)))
      .get();
  }

  private async usagesOf(drawingId: string): Promise<UsageRow[]> {
    return this.db.select().from(mapUsages).where(eq(mapUsages.drawingId, drawingId)).all();
  }

  private async drawing(id: string, ex: Executor = this.db): Promise<DrawingRow> {
    const row = await ex.select().from(mapDrawings).where(eq(mapDrawings.id, id)).get();
    if (!row) throw notFound('Map drawing', id);
    return row;
  }

  private async href(fileId: string): Promise<string> {
    const { row } = await this.files.get(fileId);
    return `/api/files/${row.id}/${encodeURIComponent(row.filename)}`;
  }

  /** Checks an uploaded file is a map; SVG shapes without ids get one (stored as a new file). */
  private async prepare(
    fileId: string,
    who: Actor,
  ): Promise<{ kind: MapKind; fileId: string; filename: string }> {
    const { row, path } = await this.files.get(fileId);
    if (row.mime === 'image/svg+xml' || /\.svg$/i.test(row.filename)) {
      if (row.size > MAX_SVG_BYTES) {
        throw invalid('That drawing is too large for a map (max 10 MB)');
      }
      const { svg, added } = addMissingSvgIds(await readFile(path, 'utf8'));
      if (added === 0) return { kind: 'svg_2d', fileId: row.id, filename: row.filename };
      const stored = await this.files.store(
        Buffer.from(svg),
        { filename: row.filename, mime: 'image/svg+xml' },
        who,
      );
      return { kind: 'svg_2d', fileId: stored.id, filename: stored.filename };
    }
    if (row.mime === 'model/gltf-binary' || /\.glb$/i.test(row.filename)) {
      if (row.size > MAX_MODEL_BYTES) {
        throw invalid('That model is too large for a map (max 100 MB)');
      }
      return { kind: 'gltf_3d', fileId: row.id, filename: row.filename };
    }
    throw invalid('Maps are SVG drawings (.svg) or binary glTF models (.glb)');
  }

  /** Shape keys in a drawing: SVG element ids or 3D object names. Stored files never change. */
  private async elementKeys(drawing: DrawingRow): Promise<string[]> {
    const cached = this.keyCache.get(drawing.fileId);
    if (cached) return cached;
    const { path } = await this.files.get(drawing.fileId);
    const keys =
      drawing.kind === 'svg_2d'
        ? svgElementIds(await readFile(path, 'utf8'))
        : glbNodeNames(await readFile(path));
    this.keyCache.set(drawing.fileId, keys);
    return keys;
  }

  private async checkUsage(loc: LocationRow, usage: UsageRow, drawing: DrawingRow) {
    return (await this.resolveLinks(loc, usage, drawing)).check;
  }

  /** The sanity check, plus the place id behind each working link. */
  private async resolveLinks(
    loc: LocationRow,
    usage: UsageRow,
    drawing: DrawingRow,
    ex: Executor = this.db,
  ): Promise<{ check: MapCheck; targets: { elementKey: string; targetId: string }[] }> {
    const keys = await this.elementKeys(drawing);
    const present = new Set(keys);
    const inside = await ex
      .select()
      .from(locations)
      .where(like(locations.path, `${loc.path}%`))
      .all();
    const byId = new Map(inside.map((l) => [l.id, l]));
    const byCode = new Map(inside.filter((l) => l.id !== loc.id).map((l) => [l.code, l]));
    const explicit = await ex.select().from(mapLinks).where(eq(mapLinks.usageId, usage.id)).all();

    const links: MapLink[] = [];
    const broken: MapLink[] = [];
    const linkedTargets = new Set<string>();
    const targets: { elementKey: string; targetId: string }[] = [];
    for (const l of explicit) {
      const target = byId.get(l.targetId);
      if (!target) continue; // moved out of this place since
      const link = { elementKey: l.elementKey, code: target.code, name: target.name, auto: false };
      if (present.has(l.elementKey)) {
        links.push(link);
        linkedTargets.add(target.id);
        targets.push({ elementKey: l.elementKey, targetId: target.id });
      } else broken.push(link);
    }
    // loc-<code> names in the drawing link by themselves, unless a click-made link says otherwise.
    const unknown = new Set<string>();
    const explicitKeys = new Set(explicit.map((l) => l.elementKey));
    for (const key of keys) {
      const code = drawing.kind === 'svg_2d' ? codeFromElementId(key) : codeFromObjectName(key);
      if (!code || explicitKeys.has(key)) continue;
      const target = byCode.get(code);
      if (!target) unknown.add(code);
      else if (!linkedTargets.has(target.id)) {
        links.push({ elementKey: key, code: target.code, name: target.name, auto: true });
        linkedTargets.add(target.id);
        targets.push({ elementKey: key, targetId: target.id });
      }
    }
    const byName = (x: { name: string }, y: { name: string }) =>
      x.name.localeCompare(y.name, undefined, { numeric: true });
    const usedBy = await ex
      .select()
      .from(mapUsages)
      .where(eq(mapUsages.drawingId, drawing.id))
      .all();
    const check: MapCheck = {
      drawing: { id: drawing.id, name: drawing.name, kind: drawing.kind, usedBy: usedBy.length },
      links: links.sort(byName),
      broken: broken.sort(byName),
      notLinked: inside
        .filter((l) => l.parentId === loc.id && !linkedTargets.has(l.id))
        .map((l) => ({ code: l.code, name: l.name }))
        .sort(byName),
      unknown: [...unknown],
    };
    return { check, targets };
  }

  /** Every place below `root`, with its path of names and of positions among its siblings. */
  private async subtree(root: LocationRow) {
    const rows = await this.db
      .select()
      .from(locations)
      .where(like(locations.path, `${root.path}%`))
      .all();
    const children = new Map<string, LocationRow[]>();
    for (const r of rows) {
      if (r.id === root.id || !r.parentId) continue;
      children.set(r.parentId, [...(children.get(r.parentId) ?? []), r]);
    }
    const out: { id: string; names: string[]; positions: number[] }[] = [];
    const walk = (parentId: string, names: string[], positions: number[]) => {
      const kids = (children.get(parentId) ?? []).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
      kids.forEach((k, i) => {
        const entry = { id: k.id, names: [...names, k.name], positions: [...positions, i] };
        out.push(entry);
        walk(k.id, entry.names, entry.positions);
      });
    };
    walk(root.id, [], []);
    return out;
  }
}
