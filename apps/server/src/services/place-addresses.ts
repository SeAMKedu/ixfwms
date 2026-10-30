import { autoShortName, type LocationSummary } from '@ixfwms/domain';
import { eq, isNull, or } from 'drizzle-orm';
import { many, type Executor } from '../db/client.js';
import { locations } from '../db/schema.js';
import { invalid } from '../lib/errors.js';
import type { LocationRow, LocationService } from './locations.js';

/** The places addresses start at: address roots and everything at the top level. */
const ADDRESS_START = or(eq(locations.addressRoot, true), isNull(locations.parentId))!;

const nextTo = (parentId: string | null) =>
  parentId ? eq(locations.parentId, parentId) : isNull(locations.parentId);

/**
 * Fixed places whose short name is the same as `loc`'s in the same address position, so their
 * addresses are too: those next to it and, where an address starts at it, other such places.
 */
export async function addressClashes(
  ex: Executor,
  places: LocationService,
  loc: LocationRow,
): Promise<LocationSummary[]> {
  const rows = await many(
    ex
      .select()
      .from(locations)
      .where(
        or(nextTo(loc.parentId), loc.addressRoot || !loc.parentId ? ADDRESS_START : undefined),
      ),
  );
  const all = await places.summaries(ex, rows);
  const own = all.find((s) => s.id === loc.id);
  if (!own || own.movable) return [];
  return all.filter(
    (s) => s.id !== loc.id && !s.movable && s.kind === 'normal' && s.short === own.short,
  );
}

/** An explicitly set short name must differ from the fixed places next to it. */
export async function checkShortName(
  ex: Executor,
  places: LocationService,
  parentId: string | null,
  shortName: string | null,
  selfId: string | null,
): Promise<void> {
  if (!shortName) return;
  const siblings = await many(ex.select().from(locations).where(nextTo(parentId)));
  const taken = (await places.summaries(ex, siblings)).find(
    (s) => s.id !== selfId && !s.movable && s.short.toLowerCase() === shortName.toLowerCase(),
  );
  if (taken) throw invalid('places.shortNameTaken', { name: taken.name, short: taken.short });
}

/**
 * Where addresses start, short names must be unique across the whole system: always for an
 * address root, and for a top-level place when its short name is set, as next to others.
 */
export async function checkAddressStart(
  ex: Executor,
  places: LocationService,
  place: {
    id: string | null;
    name: string;
    shortName: string | null;
    root: boolean;
    topLevel: boolean;
    movable: boolean;
  },
): Promise<void> {
  if (place.root && place.movable) throw invalid('places.rootMustBeFixed', { name: place.name });
  if (place.movable || !(place.root || (place.topLevel && place.shortName))) return;
  const short = (place.shortName || autoShortName(place.name)).toLowerCase();
  const starts = await places.summaries(
    ex,
    await many(ex.select().from(locations).where(ADDRESS_START)),
  );
  const taken = starts.find(
    (s) =>
      s.id !== place.id && !s.movable && s.kind === 'normal' && s.short.toLowerCase() === short,
  );
  if (taken) throw invalid('places.addressStartTaken', { name: taken.name, short: taken.short });
}
