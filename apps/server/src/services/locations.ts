import {
  addressOf,
  BUILT_IN_LOCATION_TYPES,
  DEFAULT_LOCATION_TYPES,
  LocationTypeInput,
  nextShortName,
  type LocationTypeInfo,
  type OverduePlace,
  isValidCode,
  normalizeCode,
  nextFreeName,
  DuplicateLocationInput,
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
    return this.db.transaction(async (tx) => {
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
      return this.summarize(tx, row);
    });
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

  /**
   * Copies a place with everything below it (names, types, descriptions; not stock), each copy
   * with a new code. Copies are named on from the original (Cabinet A → Cabinet B, C…) unless a
   * name is given. `afterCopy` gets original → copy ids, for copying maps along.
   */
  async duplicate(
    ref: string,
    input: DuplicateLocationInput,
    actor: Actor | null,
    afterCopy?: (tx: Executor, pairs: Map<string, string>) => Promise<void>,
  ): Promise<LocationSummary[]> {
    const who = requireScope(actor, 'inventory');
    const { name, parent, count } = DuplicateLocationInput.parse(input);
    return this.db.transaction(async (tx) => {
      const original = await this.resolve(ref, tx);
      if (original.kind !== 'normal') throw invalid('places.cantCopy', { name: original.name });
      const parentId =
        parent === undefined ? original.parentId : parent && (await this.resolve(parent, tx)).id;
      const inside = await many(
        tx
          .select()
          .from(locations)
          .where(like(locations.path, `${original.path}%`)),
      );
      const types = new Map(
        (await many(tx.select().from(locationTypes))).map((t) => [t.id, t.key]),
      );
      const copies: LocationSummary[] = [];
      let previous = original.name;
      let shortRoot = original.shortName;
      for (let n = 0; n < count; n++) {
        const siblingRows = await many(
          tx
            .select()
            .from(locations)
            .where(parentId ? eq(locations.parentId, parentId) : isNull(locations.parentId)),
        );
        const taken = siblingRows.map((s) => s.name);
        const copyName = name && n === 0 ? name : nextFreeName(previous, taken);
        previous = copyName;
        // A set short name steps on too (A → B); a guessed one follows the new name by itself.
        if (shortRoot) {
          const shorts = (await this.summaries(tx, siblingRows)).map((x) => x.short.toLowerCase());
          do shortRoot = nextShortName(shortRoot);
          while (shorts.includes(shortRoot.toLowerCase()));
        }
        const pairs = new Map<string, string>();
        // Parents come before children when sorted by path length.
        for (const row of [...inside].sort((a, b) => a.path.length - b.path.length)) {
          const isRoot = row.id === original.id;
          const copy = await this.insert(tx, {
            name: isRoot ? copyName : row.name,
            parent: isRoot ? parentId : pairs.get(row.parentId!)!,
            typeKey: types.get(row.typeId) ?? 'box',
            kind: 'normal',
            description: row.description,
            shortName: isRoot ? shortRoot : row.shortName,
          });
          pairs.set(row.id, copy.id);
          if (isRoot) copies.push(await this.summarize(tx, copy));
        }
        await afterCopy?.(tx, pairs);
        await audit(tx, who, 'duplicate', 'location', pairs.get(original.id)!, {
          from: original.id,
          places: pairs.size,
        });
      }
      return copies;
    });
  }

  /** Move logic for callers that already hold a transaction. */
  async moveWithin(
    tx: Executor,
    loc: LocationRow,
    newParentRef: string | null,
    who: Actor,
  ): Promise<void> {
    if (loc.kind !== 'normal') throw invalid('places.cantMove', { name: loc.name });
    const parent = newParentRef ? await this.resolve(newParentRef, tx) : null;
    if (parent && parent.path.startsWith(loc.path)) {
      throw invalid('places.intoItself', { name: loc.name });
    }
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

  async children(parentRef: string | null, ex: Executor = this.db): Promise<LocationSummary[]> {
    const parentId = parentRef ? (await this.resolve(parentRef, ex)).id : null;
    const rows = await many(
      ex
        .select()
        .from(locations)
        .where(parentId ? eq(locations.parentId, parentId) : isNull(locations.parentId))
        .orderBy(asc(locations.name)),
    );
    return this.summaries(ex, rows);
  }

  /** Location tree below `rootRef` (or everything), limited to `depth` levels. */
  async tree(rootRef: string | null, depth = 10): Promise<LocationNode[]> {
    const root = rootRef ? await this.resolve(rootRef) : null;
    const rows = await many(
      this.db
        .select()
        .from(locations)
        .where(root ? like(locations.path, `${root.path}%`) : undefined)
        .orderBy(asc(locations.name)),
    );
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

  /** Every place with its path of names, so a client can search "cab a › shelf 3" without more requests. */
  async allWithPaths(): Promise<PlaceOption[]> {
    const rows = await many(this.db.select().from(locations));
    const summaries = await this.summaries(this.db, rows);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return rows
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
        r.kind !== 'normal' || r.stayDays === 0
          ? null
          : (r.stayDays ?? types.get(r.typeId)?.stayDays ?? null);
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
      };
    });
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

  /** "Still needed": restarts a temporary place's clock. */
  async stillNeeded(ref: string, actor: Actor | null): Promise<LocationSummary> {
    const who = requireScope(actor, 'inventory');
    const loc = await this.resolve(ref);
    await this.touch(this.db, [loc.id]);
    await audit(this.db, who, 'still-needed', 'location', loc.id);
    return this.summarize(this.db, await this.resolve(loc.id));
  }

  /** Temporary places left untouched longer than expected, longest overdue first. */
  async overdue(): Promise<OverduePlace[]> {
    const rows = await many(this.db.select().from(locations).where(eq(locations.kind, 'normal')));
    const summaries = await this.summaries(this.db, rows);
    const late = summaries
      .map((s, i) => ({ s, row: rows[i]! }))
      .filter(({ s }) => s.overdue)
      .sort((a, b) => a.s.dueAt!.localeCompare(b.s.dueAt!));
    return Promise.all(
      late.map(async ({ s, row }) => ({
        place: s,
        path: await this.pathOf(row),
        contact: row.contact,
        lastActivityAt: row.lastActivityAt ?? row.updatedAt,
      })),
    );
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

  // --- place types ---------------------------------------------------------------------------

  async types(): Promise<LocationTypeInfo[]> {
    const rows = await many(this.db.select().from(locationTypes).orderBy(asc(locationTypes.sort)));
    const counts = await many(
      this.db
        .select({ typeId: locations.typeId, n: sql<number>`count(*)` })
        .from(locations)
        .groupBy(locations.typeId),
    );
    const byType = new Map(counts.map((c) => [c.typeId, Number(c.n)]));
    return rows
      .filter((t) => !BUILT_IN_LOCATION_TYPES.some((b) => b === t.key))
      .map((t) => ({
        key: t.key,
        name: t.name,
        movable: t.movable,
        stayDays: t.stayDays,
        workstation: t.workstation,
        sort: t.sort,
        places: byType.get(t.id) ?? 0,
      }));
  }

  async createType(input: LocationTypeInput, actor: Actor | null): Promise<LocationTypeInfo> {
    const who = requireScope(actor, 'write');
    const { name, movable, stayDays, workstation, sort } = LocationTypeInput.parse(input);
    const existing = await many(this.db.select().from(locationTypes));
    const base = typeKey(name);
    let key = base;
    for (let n = 2; existing.some((t) => t.key === key); n++) key = `${base}_${n}`;
    const next = Math.max(0, ...existing.map((t) => t.sort)) + 1;
    await this.db
      .insert(locationTypes)
      .values({ id: newId(), key, name, movable, stayDays, workstation, sort: sort ?? next });
    await audit(this.db, who, 'create', 'location-type', key, { name, movable });
    return (await this.types()).find((t) => t.key === key)!;
  }

  async updateType(
    key: string,
    input: Partial<LocationTypeInput>,
    actor: Actor | null,
  ): Promise<LocationTypeInfo> {
    const who = requireScope(actor, 'write');
    const type = await this.editableType(key);
    // Only the fields given: a partial schema would fill the others with their defaults.
    const parsed = LocationTypeInput.partial().parse(input);
    const patch = Object.fromEntries(
      Object.entries(parsed).filter(([k]) => k in input),
    ) as typeof parsed;
    await this.db
      .update(locationTypes)
      .set({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.movable !== undefined && { movable: patch.movable }),
        ...(patch.stayDays !== undefined && { stayDays: patch.stayDays }),
        ...(patch.workstation !== undefined && { workstation: patch.workstation }),
        ...(patch.sort !== undefined && { sort: patch.sort }),
      })
      .where(eq(locationTypes.id, type.id));
    await audit(this.db, who, 'update', 'location-type', key, { ...patch });
    return (await this.types()).find((t) => t.key === key)!;
  }

  async deleteType(key: string, actor: Actor | null): Promise<void> {
    const who = requireScope(actor, 'write');
    const type = await this.editableType(key);
    const used = await many(
      this.db
        .select({ id: locations.id })
        .from(locations)
        .where(eq(locations.typeId, type.id))
        .limit(1),
    );
    if (used.length) throw invalid('places.typeInUse', { type: type.name });
    await this.db.delete(locationTypes).where(eq(locationTypes.id, type.id));
    await audit(this.db, who, 'delete', 'location-type', key);
  }

  private async editableType(key: string) {
    const type = await one(this.db.select().from(locationTypes).where(eq(locationTypes.key, key)));
    if (!type || BUILT_IN_LOCATION_TYPES.some((b) => b === key)) throw notFound('placeType', key);
    return type;
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

  private async insert(
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

/** "Tool cart" → "tool_cart": keys for new place types. */
function typeKey(name: string): string {
  const key = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30);
  return key || 'type';
}
