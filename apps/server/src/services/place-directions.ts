import type { PlaceStep } from '@ixfwms/domain';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { many, type Executor } from '../db/client.js';
import { locations, locationTypes } from '../db/schema.js';
import { placeName } from './context.js';
import type { LocationRow } from './locations.js';

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * The way to `loc` from the top down: each place's written hint for finding it inside the one
 * before, and its number among its kind when the parent says which way they are counted
 * ("Shelf 2" is the second of five from the bottom). Made for a voice assistant to put in words.
 */
export async function directionsTo(ex: Executor, loc: LocationRow): Promise<PlaceStep[]> {
  const ids = loc.path.split('/').filter(Boolean);
  const rows = new Map(
    (await many(ex.select().from(locations).where(inArray(locations.id, ids)))).map((r) => [
      r.id,
      r,
    ]),
  );
  const types = new Map((await many(ex.select().from(locationTypes))).map((t) => [t.id, t]));
  const path = ids.map((id) => rows.get(id)).filter((r): r is LocationRow => r != null);
  const steps: PlaceStep[] = [];
  for (const [i, row] of path.entries()) {
    const type = types.get(row.typeId);
    const step: PlaceStep = { name: placeName(row), type: type?.key ?? 'unknown' };
    if (row.hint) step.hint = row.hint;
    const parent = path[i - 1];
    if (parent?.numberFrom) {
      const position = await positionAmong(ex, row);
      if (position) step.position = { ...position, from: parent.numberFrom };
    }
    steps.push(step);
  }
  return steps;
}

/**
 * Which one `row` is among the places of its type next to it, in order of their short names, or
 * names where none is set ("Shelf 1, 2, 10"). Short names first, so drawers can be named after
 * what's in them ("M3×10 DIN 912") and still be counted 1, 2, 3 from the left.
 */
async function positionAmong(ex: Executor, row: LocationRow) {
  const siblings = await many(
    ex
      .select({ id: locations.id, name: locations.name, shortName: locations.shortName })
      .from(locations)
      .where(
        and(
          eq(locations.parentId, row.parentId!),
          eq(locations.typeId, row.typeId),
          isNull(locations.archivedAt),
        ),
      ),
  );
  if (siblings.length < 2) return null;
  const key = (s: (typeof siblings)[number]) => s.shortName || s.name;
  siblings.sort((a, b) => byName.compare(key(a), key(b)));
  return { n: siblings.findIndex((s) => s.id === row.id) + 1, of: siblings.length };
}
