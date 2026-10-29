import {
  addressOf,
  BUILT_IN_LOCATION_TYPES,
  DEFAULT_LOCATION_TYPES,
  type OverduePlace,
  isValidCode,
  normalizeCode,
  type CreateLocationInput,
  type LocationKind,
  type LocationNode,
  type LocationSummary,
  type PlaceOption,
  type UpdateLocationInput,
} from '@ixfwms/domain';
import { and, asc, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import { many, one, type Db, type Executor } from '../db/client.js';
import { locationMoves, locations, locationTypes } from '../db/schema.js';
import { invalid, notFound } from '../lib/errors.js';
import { newId, nowIso } from '../lib/ids.js';
import { allocateCode, claimCode } from './codes.js';
import { audit, placeName, requireScope, type Actor } from './context.js';
import { checkNotLent } from './loans.js';
import { PlaceCopy } from './place-copy.js';
import { TemporaryPlaces } from './temporary.js';

export type LocationRow = typeof locations.$inferSelect;
export type { LocationNode, LocationSummary };

const INBOX_NAME = 'Inbox';
const AWAY_NAME = 'Out of the lab';
const DAY_MS = 86_400_000;

export class LocationService {
  constructor(private readonly db: Db) {}

  /** Seeds location types, the Inbox and "Out of the lab". Safe to run on every start. */
  async ensureDefaults(): Promise<void> {
    const existing = await many(this.db.select().from(locationTypes));
    const keys = new Set(existing.map((t) => t.key));
    let sort = existing.length;
    const defaults = [
      ...DEFAULT_LOCATION_TYPES,
      {
        key: 'in_transit',
        name: 'Being carried',
        movable: false,
        stayDays: null,
        workstation: false,
        build: false,
      },
    ];
    // Only for a new database: types removed in the app on purpose stay removed.
    const fresh = existing.length === 0;
    for (const t of defaults) {
      if (!keys.has(t.key) && (fresh || BUILT_IN_LOCATION_TYPES.some((b) => b === t.key))) {
        await this.db.insert(locationTypes).values({
          id: newId(),
          key: t.key,
          name: t.name,
          movable: t.movable,
          stayDays: t.stayDays,
          workstation: t.workstation,
          build: t.build,
          sort: sort++,
        });
      }
    }
    const inbox = await one(this.db.select().from(locations).where(eq(locations.kind, 'inbox')));
    if (!inbox) {
      await this.insert(this.db, {
        name: INBOX_NAME,
        parent: null,
        typeKey: 'system',
        kind: 'inbox',
        description: 'Things we own but have not put away yet: new orders and AI drafts.',
      });
    }
    const away = await one(this.db.select().from(locations).where(eq(locations.kind, 'away')));
    if (!away) {
      await this.insert(this.db, {
        name: AWAY_NAME,
        parent: null,
        typeKey: 'system',
        kind: 'away',
        description: 'Things lent out of the lab, each with the person responsible for it.',
      });
    }
  }

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

  async create(input: CreateLocationInput, actor: Actor | null): Promise<LocationSummary> {
    const who = requireScope(actor, 'inventory');
    return this.db.transaction(async (tx) =>
      this.summarize(tx, await this.createWithin(tx, input, who)),
    );
  }

  /** Create logic for callers that already hold a transaction. */
  async createWithin(
    tx: Executor,
    input: Omit<CreateLocationInput, 'type'> & { type: string },
    who: Actor,
  ): Promise<LocationRow> {
    const row = await this.insert(tx, {
      name: input.name,
      parent: input.parent ?? null,
      typeKey: input.type,
      kind: 'normal',
      description: input.description ?? null,
      code: input.code ?? null,
      shortName: input.shortName ?? null,
      stayDays: input.stayDays ?? null,
      contact: input.contact ?? null,
    });
    await audit(tx, who, 'create', 'location', row.id, {
      name: row.name,
      parentId: row.parentId,
    });
    return row;
  }

  async update(
    ref: string,
    input: UpdateLocationInput,
    actor: Actor | null,
  ): Promise<LocationSummary> {
    const who = requireScope(actor, 'inventory');
    return this.db.transaction(async (tx) => {
      const loc = await this.resolve(ref, tx);
      const patch: Partial<LocationRow> = { updatedAt: nowIso() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.stayDays !== undefined) patch.stayDays = input.stayDays ?? null;
      if (input.contact !== undefined) patch.contact = input.contact ?? null;
      if (input.shortName !== undefined) {
        patch.shortName = input.shortName ?? null;
        await this.checkShortName(tx, loc.parentId, patch.shortName, loc.id);
      }
      if (input.description !== undefined) patch.description = input.description ?? null;
      if (input.type !== undefined) patch.typeId = (await this.typeByKey(tx, input.type)).id;
      await tx.update(locations).set(patch).where(eq(locations.id, loc.id));
      await audit(tx, who, 'update', 'location', loc.id, { ...input });
      return this.summarize(tx, await this.resolve(loc.id, tx));
    });
  }

  /** Moves a location, with everything inside it, under a new parent (or to the top level). */
  async move(
    ref: string,
    newParentRef: string | null,
    actor: Actor | null,
  ): Promise<LocationSummary> {
    const who = requireScope(actor, 'inventory');
    return this.db.transaction(async (tx) => {
      const loc = await this.resolve(ref, tx);
      await this.moveWithin(tx, loc, newParentRef, who);
      return this.summarize(tx, await this.resolve(loc.id, tx));
    });
  }

  /** Copies a place with everything below it; see PlaceCopy. */
  async duplicate(...args: Parameters<PlaceCopy['duplicate']>): Promise<LocationSummary[]> {
    return new PlaceCopy(this.db, this).duplicate(...args);
  }

  /** Move logic for callers that already hold a transaction. */
  async moveWithin(
    tx: Executor,
    loc: LocationRow,
    newParentRef: string | null,
    who: Actor,
  ): Promise<void> {
    if (loc.kind !== 'normal') throw invalid('places.cantMove', { name: loc.name });
    await checkNotLent(tx, loc);
    const parent = newParentRef ? await this.resolve(newParentRef, tx) : null;
    if (parent && parent.path.startsWith(loc.path)) {
      throw invalid('places.intoItself', { name: loc.name });
    }
    if (parent) await this.checkOpen(parent, tx);
    await this.relink(tx, loc, parent, who);
  }

  /** Puts `loc` under `parent` with no questions asked; lending and returning go through here. */
  async relink(tx: Executor, loc: LocationRow, parent: LocationRow | null, who: Actor) {
    if ((parent?.id ?? null) === loc.parentId) return;
    const newPath = `${parent?.path ?? '/'}${loc.id}/`;
    await tx
      .update(locations)
      .set({ path: sql`${newPath} || substr(${locations.path}, ${loc.path.length + 1})` })
      .where(like(locations.path, `${loc.path}%`));
    await tx
      .update(locations)
      .set({ parentId: parent?.id ?? null, updatedAt: nowIso() })
      .where(eq(locations.id, loc.id));
    await this.touch(tx, [loc.id, loc.parentId, parent?.id]);
    await tx.insert(locationMoves).values({
      id: newId(),
      locationId: loc.id,
      fromParentId: loc.parentId,
      toParentId: parent?.id ?? null,
      userId: who.userId,
    });
  }

  /** The per-user "Being carried by <name>" location used while moving things around. */
  async inTransitFor(actor: Actor, ex: Executor = this.db): Promise<LocationRow> {
    const existing = await one(
      ex
        .select()
        .from(locations)
        .where(and(eq(locations.kind, 'in_transit'), eq(locations.ownerUserId, actor.userId))),
    );
    if (existing) return existing;
    return this.insert(ex, {
      name: `Carried by ${actor.name}`,
      parent: null,
      typeKey: 'in_transit',
      kind: 'in_transit',
      description: null,
      ownerUserId: actor.userId,
    });
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

  /**
   * Notes activity at places (stock in or out, a move, "still needed"), and at everything they're
   * in: taking screws out of a box on a pallet is activity on the pallet too.
   */
  async touch(ex: Executor, ids: (string | null | undefined)[]): Promise<void> {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (!wanted.length) return;
    const rows = await many(
      ex.select({ path: locations.path }).from(locations).where(inArray(locations.id, wanted)),
    );
    const all = [...new Set(rows.flatMap((r) => r.path.split('/').filter(Boolean)))];
    if (all.length)
      await ex
        .update(locations)
        .set({ lastActivityAt: nowIso() })
        .where(inArray(locations.id, all));
  }

  /** "Still needed": restarts a temporary place's clock; see TemporaryPlaces. */
  async stillNeeded(ref: string, actor: Actor | null): Promise<LocationSummary> {
    return new TemporaryPlaces(this.db, this).stillNeeded(ref, actor);
  }

  /** Temporary places left untouched longer than expected; see TemporaryPlaces. */
  async overdue(): Promise<OverduePlace[]> {
    return new TemporaryPlaces(this.db, this).overdue();
  }

  /** Fixed places next to `loc` whose short name is the same, so their addresses are too. */
  async clashes(loc: LocationRow): Promise<LocationSummary[]> {
    const siblings = await many(
      this.db
        .select()
        .from(locations)
        .where(loc.parentId ? eq(locations.parentId, loc.parentId) : isNull(locations.parentId)),
    );
    const all = await this.summaries(this.db, siblings);
    const own = all.find((s) => s.id === loc.id);
    if (!own || own.movable) return [];
    return all.filter((s) => s.id !== loc.id && !s.movable && s.short === own.short);
  }

  /** An explicitly set short name must differ from the fixed places next to it. */
  private async checkShortName(
    ex: Executor,
    parentId: string | null,
    shortName: string | null,
    selfId: string | null,
  ): Promise<void> {
    if (!shortName) return;
    const siblings = await many(
      ex
        .select()
        .from(locations)
        .where(parentId ? eq(locations.parentId, parentId) : isNull(locations.parentId)),
    );
    const taken = (await this.summaries(ex, siblings)).find(
      (s) => s.id !== selfId && !s.movable && s.short.toLowerCase() === shortName.toLowerCase(),
    );
    if (taken) throw invalid('places.shortNameTaken', { name: taken.name, short: taken.short });
  }

  private async typeByKey(ex: Executor, key: string) {
    const type = await one(ex.select().from(locationTypes).where(eq(locationTypes.key, key)));
    if (!type) {
      const known = (await many(ex.select({ key: locationTypes.key }).from(locationTypes))).map(
        (t) => t.key,
      );
      throw invalid('places.unknownType', { key, known: known.join(', ') });
    }
    return type;
  }

  /** A new place row (with its code), checked against its type and parent. */
  async insert(
    ex: Executor,
    input: {
      name: string;
      parent: string | null;
      typeKey: string;
      kind: LocationKind;
      description: string | null;
      ownerUserId?: string;
      code?: string | null;
      shortName?: string | null;
      stayDays?: number | null;
      contact?: string | null;
    },
  ): Promise<LocationRow> {
    const type = await this.typeByKey(ex, input.typeKey);
    const parent = input.parent ? await this.resolve(input.parent, ex) : null;
    if (parent && parent.kind !== 'normal' && input.kind === 'normal') {
      throw invalid('places.cantCreateInside', { name: parent.name });
    }
    if (parent) await this.checkOpen(parent, ex);
    if (type.movable === false)
      await this.checkShortName(ex, parent?.id ?? null, input.shortName ?? null, null);
    const id = newId();
    const row = {
      id,
      code: input.code ? await claimCode(ex, input.code) : await allocateCode(ex),
      parentId: parent?.id ?? null,
      typeId: type.id,
      kind: input.kind,
      name: input.name,
      description: input.description,
      path: `${parent?.path ?? '/'}${id}/`,
      ownerUserId: input.ownerUserId ?? null,
      shortName: input.shortName ?? null,
      stayDays: input.stayDays ?? null,
      contact: input.contact ?? null,
      lastActivityAt: nowIso(),
    };
    await ex.insert(locations).values(row);
    return this.resolve(id, ex);
  }
}

function levelOf(path: string): number {
  return path.split('/').filter(Boolean).length;
}
