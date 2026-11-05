import {
  BUILT_IN_LOCATION_TYPES,
  LocationTypeInput,
  LocationTypePatch,
  type LocationTypeInfo,
} from '@ixfwms/domain';
import { asc, eq, sql } from 'drizzle-orm';
import { many, one, type Db } from '../../db/client.js';
import { locations, locationTypes } from '../../db/schema.js';
import { invalid, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { audit, requireScope, type Actor } from '../../lib/context.js';

/** Place types (Settings › Place types): movable, temporary, workstation, build. */
export class PlaceTypeService {
  constructor(private readonly db: Db) {}

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
        build: t.build,
        sort: t.sort,
        places: byType.get(t.id) ?? 0,
      }));
  }

  async createType(input: LocationTypeInput, actor: Actor | null): Promise<LocationTypeInfo> {
    const who = requireScope(actor, 'write');
    const { name, movable, stayDays, workstation, build, sort } = LocationTypeInput.parse(input);
    const existing = await many(this.db.select().from(locationTypes));
    const base = typeKey(name);
    let key = base;
    for (let n = 2; existing.some((t) => t.key === key); n++) key = `${base}_${n}`;
    const next = Math.max(0, ...existing.map((t) => t.sort)) + 1;
    await this.db.insert(locationTypes).values({
      id: newId(),
      key,
      name,
      movable,
      stayDays,
      workstation,
      build,
      sort: sort ?? next,
    });
    await audit(this.db, who, 'create', 'location-type', key, { name, movable });
    return (await this.types()).find((t) => t.key === key)!;
  }

  async updateType(
    key: string,
    input: LocationTypePatch,
    actor: Actor | null,
  ): Promise<LocationTypeInfo> {
    const who = requireScope(actor, 'write');
    const type = await this.editableType(key);
    const patch = LocationTypePatch.parse(input);
    await this.db
      .update(locationTypes)
      .set({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.movable !== undefined && { movable: patch.movable }),
        ...(patch.stayDays !== undefined && { stayDays: patch.stayDays }),
        ...(patch.workstation !== undefined && { workstation: patch.workstation }),
        ...(patch.build !== undefined && { build: patch.build }),
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
