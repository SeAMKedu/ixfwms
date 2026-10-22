import {
  DEFAULT_LOCATION_TYPES,
  isValidCode,
  normalizeCode,
  type CreateLocationInput,
  type LocationKind,
  type LocationNode,
  type LocationSummary,
  type UpdateLocationInput,
} from '@ixfwms/domain';
import { and, asc, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import type { Db, Executor } from '../db/client.js';
import { locationMoves, locations, locationTypes } from '../db/schema.js';
import { AppError, invalid, notFound } from '../lib/errors.js';
import { newId, nowIso } from '../lib/ids.js';
import { allocateCode } from './codes.js';
import { audit, requireScope, type Actor } from './context.js';

export type LocationRow = typeof locations.$inferSelect;
export type { LocationNode, LocationSummary };

const INBOX_NAME = 'Inbox';

export class LocationService {
  constructor(private readonly db: Db) {}

  /** Seeds location types and the Inbox. Safe to run on every start. */
  async ensureDefaults(): Promise<void> {
    const existing = await this.db.select().from(locationTypes).all();
    const keys = new Set(existing.map((t) => t.key));
    let sort = existing.length;
    for (const t of [...DEFAULT_LOCATION_TYPES, { key: 'in_transit', name: 'Being carried' }]) {
      if (!keys.has(t.key)) {
        await this.db
          .insert(locationTypes)
          .values({ id: newId(), key: t.key, name: t.name, sort: sort++ });
      }
    }
    const inbox = await this.db.select().from(locations).where(eq(locations.kind, 'inbox')).get();
    if (!inbox) {
      await this.insert(this.db, {
        name: INBOX_NAME,
        parent: null,
        typeKey: 'system',
        kind: 'inbox',
        description: 'Things we own but have not put away yet: new orders and AI drafts.',
      });
    }
  }

  async inbox(ex: Executor = this.db): Promise<LocationRow> {
    const inbox = await ex.select().from(locations).where(eq(locations.kind, 'inbox')).get();
    if (!inbox) throw new Error('Inbox missing; run ensureDefaults() first');
    return inbox;
  }

  /** Finds a location by id or short code. */
  async resolve(ref: string, ex: Executor = this.db): Promise<LocationRow> {
    const code = normalizeCode(ref);
    const row = isValidCode(code)
      ? await ex.select().from(locations).where(eq(locations.code, code)).get()
      : undefined;
    const found = row ?? (await ex.select().from(locations).where(eq(locations.id, ref)).get());
    if (!found) throw notFound('Location', ref);
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

  /** Move logic for callers that already hold a transaction. */
  async moveWithin(
    tx: Executor,
    loc: LocationRow,
    newParentRef: string | null,
    who: Actor,
  ): Promise<void> {
    if (loc.kind !== 'normal') throw invalid(`The ${loc.name} location can't be moved`);
    const parent = newParentRef ? await this.resolve(newParentRef, tx) : null;
    if (parent && parent.path.startsWith(loc.path)) {
      throw invalid(`Can't move ${loc.name} into itself or into something inside it`);
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
    const existing = await ex
      .select()
      .from(locations)
      .where(and(eq(locations.kind, 'in_transit'), eq(locations.ownerUserId, actor.userId)))
      .get();
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
      await ex.select().from(locations).where(inArray(locations.id, ids)).all(),
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((r): r is LocationSummary => r != null);
  }

  async children(parentRef: string | null, ex: Executor = this.db): Promise<LocationSummary[]> {
    const parentId = parentRef ? (await this.resolve(parentRef, ex)).id : null;
    const rows = await ex
      .select()
      .from(locations)
      .where(parentId ? eq(locations.parentId, parentId) : isNull(locations.parentId))
      .orderBy(asc(locations.name))
      .all();
    return this.summaries(ex, rows);
  }

  /** Location tree below `rootRef` (or everything), limited to `depth` levels. */
  async tree(rootRef: string | null, depth = 10): Promise<LocationNode[]> {
    const root = rootRef ? await this.resolve(rootRef) : null;
    const rows = await this.db
      .select()
      .from(locations)
      .where(root ? like(locations.path, `${root.path}%`) : undefined)
      .orderBy(asc(locations.name))
      .all();
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

  async summarize(ex: Executor, row: LocationRow): Promise<LocationSummary> {
    const [summary] = await this.summaries(ex, [row]);
    return summary!;
  }

  async summaries(ex: Executor, rows: LocationRow[]): Promise<LocationSummary[]> {
    const types = new Map((await ex.select().from(locationTypes).all()).map((t) => [t.id, t.key]));
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      type: types.get(r.typeId) ?? 'unknown',
      kind: r.kind,
    }));
  }

  private async typeByKey(ex: Executor, key: string) {
    const type = await ex.select().from(locationTypes).where(eq(locationTypes.key, key)).get();
    if (!type) {
      const known = (await ex.select({ key: locationTypes.key }).from(locationTypes).all()).map(
        (t) => t.key,
      );
      throw invalid(`Unknown location type "${key}". Known types: ${known.join(', ')}`);
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
    },
  ): Promise<LocationRow> {
    const type = await this.typeByKey(ex, input.typeKey);
    const parent = input.parent ? await this.resolve(input.parent, ex) : null;
    if (parent && parent.kind !== 'normal' && input.kind === 'normal') {
      throw new AppError('invalid', `Locations can't be created inside ${parent.name}`);
    }
    const id = newId();
    const row = {
      id,
      code: await allocateCode(ex),
      parentId: parent?.id ?? null,
      typeId: type.id,
      kind: input.kind,
      name: input.name,
      description: input.description,
      path: `${parent?.path ?? '/'}${id}/`,
      ownerUserId: input.ownerUserId ?? null,
    };
    await ex.insert(locations).values(row);
    return this.resolve(id, ex);
  }
}

function levelOf(path: string): number {
  return path.split('/').filter(Boolean).length;
}
