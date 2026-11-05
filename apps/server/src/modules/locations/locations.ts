import {
  type OverduePlace,
  type CreateLocationInput,
  type LocationKind,
  type LocationSummary,
  type NumberFrom,
  type UpdateLocationInput,
} from '@ixfwms/domain';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { many, one, type Executor } from '../../db/client.js';
import { locationMoves, locations, locationTypes } from '../../db/schema.js';
import { invalid } from '../../lib/errors.js';
import { newId, nowIso } from '../../lib/ids.js';
import { allocateCode, claimCode } from '../../services/codes.js';
import { checkAddressStart, checkShortName } from './place-addresses.js';
import { audit, requireScope, type Actor } from '../../lib/context.js';
import { checkNotLent } from '../loans/rules.js';
import { PlaceCopy } from './place-copy.js';
import { ensurePlaceDefaults } from './place-defaults.js';
import { TemporaryPlaces } from './temporary.js';

import { PlaceStore, type LocationRow } from './store.js';

export class LocationService extends PlaceStore {
  /** Seeds location types, the Inbox and "Out of the lab"; see ensurePlaceDefaults. */
  async ensureDefaults(): Promise<void> {
    return ensurePlaceDefaults(this.db, this);
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
      addressRoot: input.addressRoot,
      stayDays: input.stayDays ?? null,
      contact: input.contact ?? null,
      hint: input.hint ?? null,
      numberFrom: input.numberFrom ?? null,
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
      if (input.hint !== undefined) patch.hint = input.hint || null;
      if (input.numberFrom !== undefined) patch.numberFrom = input.numberFrom ?? null;
      if (input.shortName !== undefined) {
        patch.shortName = input.shortName ?? null;
        await checkShortName(tx, this, loc.parentId, patch.shortName, loc.id);
      }
      if (input.description !== undefined) patch.description = input.description ?? null;
      const type =
        input.type !== undefined
          ? await this.typeByKey(tx, input.type)
          : await one(tx.select().from(locationTypes).where(eq(locationTypes.id, loc.typeId)));
      if (input.type !== undefined) patch.typeId = type!.id;
      if (input.addressRoot !== undefined) patch.addressRoot = input.addressRoot;
      const shortName = patch.shortName === undefined ? loc.shortName : patch.shortName;
      await checkAddressStart(tx, this, {
        id: loc.id,
        name: patch.name ?? loc.name,
        shortName,
        root: patch.addressRoot ?? loc.addressRoot,
        topLevel: !loc.parentId,
        movable: type?.movable ?? false,
      });
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
    const moved = (parent?.id ?? null) !== loc.parentId;
    await this.relink(tx, loc, parent, who);
    // "Behind the blue bin" was about where a container was; it says nothing about its new spot.
    if (moved && loc.hint && (await this.typeOf(tx, loc)).movable)
      await tx.update(locations).set({ hint: null }).where(eq(locations.id, loc.id));
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
      addressRoot?: boolean;
      stayDays?: number | null;
      contact?: string | null;
      hint?: string | null;
      numberFrom?: NumberFrom | null;
    },
  ): Promise<LocationRow> {
    const type = await this.typeByKey(ex, input.typeKey);
    const parent = input.parent ? await this.resolve(input.parent, ex) : null;
    if (parent && parent.kind !== 'normal' && input.kind === 'normal') {
      throw invalid('places.cantCreateInside', { name: parent.name });
    }
    if (parent) await this.checkOpen(parent, ex);
    if (type.movable === false)
      await checkShortName(ex, this, parent?.id ?? null, input.shortName ?? null, null);
    await checkAddressStart(ex, this, {
      id: null,
      name: input.name,
      shortName: input.shortName ?? null,
      root: input.addressRoot ?? false,
      topLevel: !parent,
      movable: type.movable,
    });
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
      addressRoot: input.addressRoot ?? false,
      stayDays: input.stayDays ?? null,
      contact: input.contact ?? null,
      hint: input.hint || null,
      numberFrom: input.numberFrom ?? null,
      lastActivityAt: nowIso(),
    };
    await ex.insert(locations).values(row);
    return this.resolve(id, ex);
  }
}
