import { readFile } from 'node:fs/promises';
import { svgElementIds, type MapCheck, type MapDrawingInfo, type MapKind } from '@ixfwms/domain';
import { and, eq, inArray } from 'drizzle-orm';
import { many, type Executor } from '../../db/client.js';
import { mapDrawings, mapLinks, mapUsages } from '../../db/schema.js';
import { invalid, notFound } from '../../lib/errors.js';
import { newId, nowIso } from '../../lib/ids.js';
import { audit, requireScope, type Actor } from '../../lib/context.js';
import type { LocationRow } from '../locations/store.js';
import { MapViews, type UsageRow } from './views.js';

const MAX_SVG_BYTES = 10 * 1024 * 1024;
const MAX_MODEL_BYTES = 100 * 1024 * 1024;
const SHAPES = 'rect|path|circle|ellipse|polygon|polyline|line|g|use|image|text';

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
export class MapService extends MapViews {
  // --- library ---------------------------------------------------------------------------------

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
      throw invalid(drawing.kind === 'svg_2d' ? 'maps.uploadSvg' : 'maps.uploadGlb');
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
      throw invalid('maps.stillUsed', { count: used.length });
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
    if (!usage) throw notFound('map', loc.code);
    await this.db.transaction(async (tx) => {
      await tx
        .delete(mapLinks)
        .where(and(eq(mapLinks.usageId, usage.id), eq(mapLinks.elementKey, elementKey)));
      if (!targetRef) return;
      const target = await this.locations.resolve(targetRef, tx);
      if (target.id === loc.id || !target.path.startsWith(loc.path)) {
        throw invalid('maps.notInside', { target: target.name, place: loc.name });
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
    if (!target || !source) throw invalid('maps.bothNeedMap');
    if (target.drawingId !== source.drawingId) {
      throw invalid('maps.differentDrawing', { name: from.name });
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
    const originals = await many(
      tx
        .select()
        .from(mapUsages)
        .where(inArray(mapUsages.locationId, [...pairs.keys()])),
    );
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

  /** Checks an uploaded file is a map; SVG shapes without ids get one (stored as a new file). */
  private async prepare(
    fileId: string,
    who: Actor,
  ): Promise<{ kind: MapKind; fileId: string; filename: string }> {
    const { row, path } = await this.files.get(fileId);
    if (row.mime === 'image/svg+xml' || /\.svg$/i.test(row.filename)) {
      if (row.size > MAX_SVG_BYTES) {
        throw invalid('maps.svgTooLarge');
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
        throw invalid('maps.glbTooLarge');
      }
      return { kind: 'gltf_3d', fileId: row.id, filename: row.filename };
    }
    throw invalid('maps.wrongFormat');
  }
}
