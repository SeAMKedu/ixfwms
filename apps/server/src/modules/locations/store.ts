import {
  addressOf,
  isValidCode,
  normalizeCode,
  type LocationNode,
  type LocationSummary,
  type PlaceOption,
  type PlaceStep,
} from '@ixfwms/domain';
import { asc, eq, inArray, isNull, like } from 'drizzle-orm';
import { many, one, type Db, type Executor } from '../../db/client.js';
import { locations, locationTypes } from '../../db/schema.js';
import { invalid, notFound } from '../../lib/errors.js';
import { addressClashes } from './place-addresses.js';
import { placeName } from '../../lib/context.js';
import { checkNotLent } from '../loans/rules.js';
import { directionsTo } from './place-directions.js';

export type LocationRow = typeof locations.$inferSelect;
export type { LocationNode, LocationSummary };

const DAY_MS = 86_400_000;

/**
 * Finding places and describing them: what most other modules need from places. Changes are in
 * LocationService, which is a PlaceStore too.
 */
export class PlaceStore {
  constructor(protected readonly db: Db) {}

  /** The built-in place where lent units are while they're out of the lab. */
  async away(ex: Executor = this.db): Promise<LocationRow> {
    const away = await one(ex.select().from(locations).where(eq(locations.kind, 'away')));
    if (!away) throw new Error('"Out of the lab" missing; run ensureDefaults() first');
    return away;
  }

  async inbox(ex: Executor = this.db): Promise<LocationRow> {
    const inbox = await one(ex.select().from(locations).where(eq(locations.kind, 'inbox')));
    if (!inbox) throw new Error('Inbox missing; run ensureDefaults() first');
    return inbox;
  }

  /** Finds a location by id or short code. */
  async resolve(ref: string, ex: Executor = this.db): Promise<LocationRow> {
    const code = normalizeCode(ref);
    const row = isValidCode(code)
      ? await one(ex.select().from(locations).where(eq(locations.code, code)))
      : undefined;
    const found = row ?? (await one(ex.select().from(locations).where(eq(locations.id, ref))));
    if (!found) throw notFound('location', ref);
    return found;
  }

  /** Ancestors from the top level down to (and including) the location itself. */
  async pathOf(loc: Pick<LocationRow, 'path'>, ex: Executor = this.db): Promise<LocationSummary[]> {
    const ids = loc.path.split('/').filter(Boolean);
    if (ids.length === 0) return [];
    const rows = await this.summaries(
      ex,
      await many(ex.select().from(locations).where(inArray(locations.id, ids))),
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((r): r is LocationSummary => r != null);
  }

  /** Places directly inside, archived ones left out. */
  async children(parentRef: string | null, ex: Executor = this.db): Promise<LocationSummary[]> {
    const parentId = parentRef ? (await this.resolve(parentRef, ex)).id : null;
    const rows = await many(
      ex
        .select()
        .from(locations)
        .where(parentId ? eq(locations.parentId, parentId) : isNull(locations.parentId))
        .orderBy(asc(locations.name)),
    );
    return this.summaries(
      ex,
      rows.filter((r) => !r.archivedAt),
    );
  }

  /** Location tree below `rootRef` (or everything), limited to `depth` levels. */
  async tree(rootRef: string | null, depth = 10): Promise<LocationNode[]> {
    const root = rootRef ? await this.resolve(rootRef) : null;
    const rows = (
      await many(
        this.db
          .select()
          .from(locations)
          .where(root ? like(locations.path, `${root.path}%`) : undefined)
          .orderBy(asc(locations.name)),
      )
    ).filter((r) => !r.archivedAt);
    const summaries = await this.summaries(this.db, rows);
    const nodes = new Map(summaries.map((s) => [s.id, { ...s, children: [] as LocationNode[] }]));
    const top: LocationNode[] = [];
    const baseLevel = root ? levelOf(root.path) : 0;
    for (const row of rows) {
      const node = nodes.get(row.id)!;
      if (root ? row.id === root.id : row.parentId == null) {
        top.push(node);
      } else if (levelOf(row.path) - baseLevel <= depth && row.parentId) {
        nodes.get(row.parentId)?.children.push(node);
      }
    }
    return top;
  }

  /**
   * Every place with its path of names, so a client can search "cab a › shelf 3" without more
   * requests. Archived ones are left out: nothing can go in them.
   */
  async allWithPaths(): Promise<PlaceOption[]> {
    const rows = await many(this.db.select().from(locations));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const open = rows.filter((r) => !r.archivedAt);
    const summaries = await this.summaries(this.db, open);
    return open
      .map((row, i) => {
        const ids = row.path.split('/').filter(Boolean);
        return {
          ...summaries[i]!,
          path: ids.map((id) => byId.get(id)?.name ?? '?'),
          pathCodes: ids.map((id) => byId.get(id)?.code ?? '?'),
        };
      })
      .sort((a, b) => a.path.join('/').localeCompare(b.path.join('/')));
  }

  async summarize(ex: Executor, row: LocationRow): Promise<LocationSummary> {
    const [summary] = await this.summaries(ex, [row]);
    return summary!;
  }

  async summaries(ex: Executor, rows: LocationRow[]): Promise<LocationSummary[]> {
    const types = new Map((await many(ex.select().from(locationTypes))).map((t) => [t.id, t]));
    // Addresses need every place on the way down.
    const known = new Map(rows.map((r) => [r.id, r]));
    const missing = [
      ...new Set(rows.flatMap((r) => r.path.split('/').filter((id) => id && !known.has(id)))),
    ];
    for (let i = 0; i < missing.length; i += 500) {
      const batch = missing.slice(i, i + 500);
      for (const r of await many(ex.select().from(locations).where(inArray(locations.id, batch))))
        known.set(r.id, r);
    }
    const now = Date.now();
    const part = (r: LocationRow) => ({
      name: placeName(r),
      shortName: r.shortName,
      addressRoot: r.addressRoot,
      movable: types.get(r.typeId)?.movable ?? false,
    });
    return rows.map((r) => {
      const path = r.path
        .split('/')
        .filter(Boolean)
        .map((id) => known.get(id))
        .filter((x): x is LocationRow => x != null);
      const { parent, short, address } = addressOf(path.map(part));
      const stayDays =
        r.kind !== 'normal' || r.stayDays === 0 || r.dismantledAt
          ? null
          : (r.stayDays ?? types.get(r.typeId)?.stayDays ?? null);
      const build = [...path].reverse().find((p) => types.get(p.typeId)?.build);
      const since = Date.parse(r.lastActivityAt ?? r.updatedAt);
      const due = stayDays ? since + stayDays * DAY_MS : null;
      return {
        id: r.id,
        code: r.code,
        name: placeName(r),
        type: types.get(r.typeId)?.key ?? 'unknown',
        kind: r.kind,
        shortName: r.shortName,
        addressRoot: r.addressRoot,
        short,
        movable: part(r).movable,
        address,
        within: parent,
        stayDays,
        dueAt: due ? new Date(due).toISOString() : null,
        overdue: due !== null && now > due,
        workstation: types.get(r.typeId)?.workstation ?? false,
        build: types.get(r.typeId)?.build ?? false,
        inBuild: build ? { code: build.code, name: build.name } : null,
        dismantledAt: r.dismantledAt,
        archivedAt: r.archivedAt,
        outOfLab: path[0]?.kind === 'away',
      };
    });
  }

  /** Stock at `dest` is visiting (being carried, at a workstation, a temporary place or in a build). */
  async visiting(ex: Executor, dest: LocationRow): Promise<boolean> {
    const s = await this.summarize(ex, dest);
    return s.kind === 'in_transit' || s.workstation || s.stayDays !== null || s.inBuild !== null;
  }

  /**
   * Refuses to put anything in a dismantled build (dismantling empties it, places inside too),
   * an archived container (archived only while empty), or out of the lab (lend it instead).
   */
  async checkOpen<T extends LocationRow>(dest: T, ex: Executor = this.db): Promise<T> {
    if (dest.dismantledAt) throw invalid('builds.dismantled', { name: dest.name });
    if (dest.archivedAt) throw invalid('places.archived', { name: dest.name });
    if (dest.kind === 'away') throw invalid('units.lendInstead');
    await checkNotLent(ex, dest);
    return dest;
  }

  /** Fixed places whose addresses are the same as `loc`'s. */
  clashes(loc: LocationRow): Promise<LocationSummary[]> {
    return addressClashes(this.db, this, loc);
  }

  /** How to get to a place, step by step from the top; see directionsTo. */
  async directions(ref: string, ex: Executor = this.db): Promise<PlaceStep[]> {
    return directionsTo(ex, await this.resolve(ref, ex));
  }

  protected async typeOf(ex: Executor, loc: LocationRow) {
    return (await one(ex.select().from(locationTypes).where(eq(locationTypes.id, loc.typeId))))!;
  }

  protected async typeByKey(ex: Executor, key: string) {
    const type = await one(ex.select().from(locationTypes).where(eq(locationTypes.key, key)));
    if (!type) {
      const known = (await many(ex.select({ key: locationTypes.key }).from(locationTypes))).map(
        (t) => t.key,
      );
      throw invalid('places.unknownType', { key, known: known.join(', ') });
    }
    return type;
  }
}

function levelOf(path: string): number {
  return path.split('/').filter(Boolean).length;
}
