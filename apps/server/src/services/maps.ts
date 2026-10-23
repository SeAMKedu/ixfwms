import { readFile } from 'node:fs/promises';
import {
  scanGlbCodes,
  scanSvgCodes,
  type MapCheck,
  type MapKind,
  type MapLayer,
} from '@ixfwms/domain';
import { and, eq, inArray, like } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { locations, locationViews } from '../db/schema.js';
import { invalid, notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { audit, requireScope, type Actor } from './context.js';
import type { FileService } from './files.js';
import type { LocationRow, LocationService } from './locations.js';

const MAX_SVG_BYTES = 10 * 1024 * 1024;
const MAX_MODEL_BYTES = 100 * 1024 * 1024;

/**
 * Lab maps: per place, an SVG drawing and/or a 3D model (.glb). SVG element ids and 3D object
 * names like "loc-A3F9" link to the places inside it.
 */
export class MapService {
  constructor(
    private readonly db: Db,
    private readonly locations: LocationService,
    private readonly files: FileService,
  ) {}

  /**
   * Sets (or replaces) a place's map from an uploaded file: an SVG drawing or a .glb model, told
   * apart by the file. Reports how well it links up with the places inside.
   */
  async setMap(ref: string, fileId: string, actor: Actor | null): Promise<MapCheck> {
    const who = requireScope(actor, 'inventory');
    const loc = await this.locations.resolve(ref);
    const { kind, codes } = await this.read(fileId);
    await this.db
      .insert(locationViews)
      .values({ id: newId(), locationId: loc.id, kind, fileId, createdBy: who.userId })
      .onConflictDoUpdate({
        target: [locationViews.locationId, locationViews.kind],
        set: { fileId, createdBy: who.userId },
      });
    await audit(this.db, who, 'map', 'location', loc.id, { fileId, kind });
    return this.checkCodes(loc, codes);
  }

  async removeMap(ref: string, kind: MapKind, actor: Actor | null): Promise<void> {
    const who = requireScope(actor, 'inventory');
    const loc = await this.locations.resolve(ref);
    await this.db
      .delete(locationViews)
      .where(and(eq(locationViews.locationId, loc.id), eq(locationViews.kind, kind)));
    await audit(this.db, who, 'map-removed', 'location', loc.id, { kind });
  }

  async check(ref: string, kind: MapKind): Promise<MapCheck> {
    const loc = await this.locations.resolve(ref);
    const view = await this.db
      .select()
      .from(locationViews)
      .where(and(eq(locationViews.locationId, loc.id), eq(locationViews.kind, kind)))
      .get();
    if (!view) throw notFound('Map of', loc.code);
    return this.checkCodes(loc, (await this.read(view.fileId)).codes);
  }

  /**
   * "Show me where": the drawings on the way from the top level down to this place (its own included),
   * each with the codes of the path below it to highlight.
   */
  async layers(ref: string): Promise<MapLayer[]> {
    const loc = await this.locations.resolve(ref);
    const path = await this.locations.pathOf(loc);
    const views = await this.db
      .select()
      .from(locationViews)
      .where(
        inArray(
          locationViews.locationId,
          path.map((p) => p.id),
        ),
      )
      .all();
    const layers: MapLayer[] = [];
    for (const [i, place] of path.entries()) {
      // 3D first when a place has both: it's usually the richer view of the same room.
      for (const view of views
        .filter((v) => v.locationId === place.id)
        .sort((a, b) => a.kind.localeCompare(b.kind))) {
        const { row } = await this.files.get(view.fileId);
        layers.push({
          location: place,
          kind: view.kind,
          href: `/api/files/${row.id}/${encodeURIComponent(row.filename)}`,
          highlight: path.slice(i + 1).map((p) => p.code),
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
      `  <!-- ixfwms starter map for ${esc(loc.name)} (${loc.code}). Keep the ids "loc:<code>" on the groups; everything else is yours to change. -->\n` +
      `  <rect width="${width}" height="${height}" fill="#ffffff"/>\n` +
      `  <text x="${pad}" y="${pad + 8}" font-family="sans-serif" font-size="22" font-weight="bold" fill="#15202a">${esc(loc.name)}</text>\n` +
      `  ${boxes}\n</svg>\n`
    );
  }

  private async read(fileId: string): Promise<{ kind: MapKind; codes: string[] }> {
    const { row, path } = await this.files.get(fileId);
    if (row.mime === 'image/svg+xml' || /\.svg$/i.test(row.filename)) {
      if (row.size > MAX_SVG_BYTES)
        throw invalid('That drawing is too large for a map (max 10 MB)');
      return { kind: 'svg_2d', codes: scanSvgCodes(await readFile(path, 'utf8')) };
    }
    if (row.mime === 'model/gltf-binary' || /\.glb$/i.test(row.filename)) {
      if (row.size > MAX_MODEL_BYTES)
        throw invalid('That model is too large for a map (max 100 MB)');
      return { kind: 'gltf_3d', codes: scanGlbCodes(await readFile(path)) };
    }
    throw invalid('Maps are SVG drawings (.svg) or binary glTF models (.glb)');
  }

  private async checkCodes(loc: LocationRow, codes: string[]): Promise<MapCheck> {
    const inside = await this.db
      .select()
      .from(locations)
      .where(like(locations.path, `${loc.path}%`))
      .all();
    const byCode = new Map(inside.filter((l) => l.id !== loc.id).map((l) => [l.code, l]));
    return {
      linked: codes
        .filter((c) => byCode.has(c))
        .map((c) => ({ code: c, name: byCode.get(c)!.name })),
      unknown: codes.filter((c) => !byCode.has(c)),
      notDrawn: inside
        .filter((l) => l.parentId === loc.id && !codes.includes(l.code))
        .map((l) => ({ code: l.code, name: l.name })),
    };
  }
}
