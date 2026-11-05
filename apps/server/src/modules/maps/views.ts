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
import { many, one, type Db, type Executor } from '../../db/client.js';
import { locations, mapDrawings, mapLinks, mapUsages } from '../../db/schema.js';
import { notFound } from '../../lib/errors.js';
import type { FileService } from '../files/files.js';
import { starterSvg } from './map-starter.js';
import type { LocationService } from '../locations/locations.js';
import type { LocationRow } from '../locations/store.js';

export type DrawingRow = typeof mapDrawings.$inferSelect;
export type UsageRow = typeof mapUsages.$inferSelect;

/** Reading maps: the drawing library, a place's map and its layers, and checking the links. */
export class MapViews {
  protected readonly keyCache = new Map<string, string[]>();

  constructor(
    protected readonly db: Db,
    protected readonly locations: LocationService,
    protected readonly files: FileService,
  ) {}

  async drawings(): Promise<MapDrawingInfo[]> {
    const rows = await many(this.db.select().from(mapDrawings));
    const usages = await many(this.db.select().from(mapUsages));
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

  async check(ref: string, kind: MapKind): Promise<MapCheck> {
    const loc = await this.locations.resolve(ref);
    const usage = await this.usage(loc.id, kind);
    if (!usage) throw notFound('map', loc.code);
    return this.checkUsage(loc, usage, await this.drawing(usage.drawingId));
  }

  /**
   * "Show me where": the drawings on the way from the top level down to this place (its own
   * included), each with the path to highlight and which place every linked shape stands for.
   */
  async layers(ref: string): Promise<MapLayer[]> {
    const loc = await this.locations.resolve(ref);
    const path = await this.locations.pathOf(loc);
    const usages = await many(
      this.db
        .select()
        .from(mapUsages)
        .where(
          inArray(
            mapUsages.locationId,
            path.map((p) => p.id),
          ),
        ),
    );
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

  /** A starting drawing: a linked box per sub-place, with the places inside each (see map-starter.ts). */
  async starterSvg(ref: string): Promise<string> {
    return starterSvg(this.db, await this.locations.resolve(ref));
  }

  // --- internals -------------------------------------------------------------------------------

  protected async usage(locationId: string, kind: MapKind): Promise<UsageRow | undefined> {
    return one(
      this.db
        .select()
        .from(mapUsages)
        .where(and(eq(mapUsages.locationId, locationId), eq(mapUsages.kind, kind))),
    );
  }

  protected async usagesOf(drawingId: string): Promise<UsageRow[]> {
    return many(this.db.select().from(mapUsages).where(eq(mapUsages.drawingId, drawingId)));
  }

  protected async drawing(id: string, ex: Executor = this.db): Promise<DrawingRow> {
    const row = await one(ex.select().from(mapDrawings).where(eq(mapDrawings.id, id)));
    if (!row) throw notFound('mapDrawing', id);
    return row;
  }

  protected async href(fileId: string): Promise<string> {
    const { row } = await this.files.get(fileId);
    return `/api/files/${row.id}/${encodeURIComponent(row.filename)}`;
  }

  /** Shape keys in a drawing: SVG element ids or 3D object names. Stored files never change. */
  protected async elementKeys(drawing: DrawingRow): Promise<string[]> {
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

  protected async checkUsage(loc: LocationRow, usage: UsageRow, drawing: DrawingRow) {
    return (await this.resolveLinks(loc, usage, drawing)).check;
  }

  /** The sanity check, plus the place id behind each working link. */
  protected async resolveLinks(
    loc: LocationRow,
    usage: UsageRow,
    drawing: DrawingRow,
    ex: Executor = this.db,
  ): Promise<{ check: MapCheck; targets: { elementKey: string; targetId: string }[] }> {
    const keys = await this.elementKeys(drawing);
    const present = new Set(keys);
    const inside = await many(
      ex
        .select()
        .from(locations)
        .where(like(locations.path, `${loc.path}%`)),
    );
    const byId = new Map(inside.map((l) => [l.id, l]));
    const byCode = new Map(inside.filter((l) => l.id !== loc.id).map((l) => [l.code, l]));
    const explicit = await many(ex.select().from(mapLinks).where(eq(mapLinks.usageId, usage.id)));

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
    const usedBy = await many(
      ex.select().from(mapUsages).where(eq(mapUsages.drawingId, drawing.id)),
    );
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
  protected async subtree(root: LocationRow) {
    const rows = await many(
      this.db
        .select()
        .from(locations)
        .where(like(locations.path, `${root.path}%`)),
    );
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
