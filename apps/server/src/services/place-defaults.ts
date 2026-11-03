import { BUILT_IN_LOCATION_TYPES, DEFAULT_LOCATION_TYPES } from '@ixfwms/domain';
import { eq } from 'drizzle-orm';
import { many, one, type Db } from '../db/client.js';
import { locations, locationTypes } from '../db/schema.js';
import { newId } from '../lib/ids.js';
import type { LocationService } from './locations.js';

const INBOX_NAME = 'Inbox';
const AWAY_NAME = 'Out of the lab';

/** Seeds location types, the Inbox and "Out of the lab". Safe to run on every start. */
export async function ensurePlaceDefaults(db: Db, places: LocationService): Promise<void> {
  const existing = await many(db.select().from(locationTypes));
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
      await db.insert(locationTypes).values({
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
  const inbox = await one(db.select().from(locations).where(eq(locations.kind, 'inbox')));
  if (!inbox) {
    await places.insert(db, {
      name: INBOX_NAME,
      parent: null,
      typeKey: 'system',
      kind: 'inbox',
      description: 'Things we own but have not put away yet: new orders and AI drafts.',
    });
  }
  const away = await one(db.select().from(locations).where(eq(locations.kind, 'away')));
  if (!away) {
    await places.insert(db, {
      name: AWAY_NAME,
      parent: null,
      typeKey: 'system',
      kind: 'away',
      description: 'Things lent out of the lab, each with the person responsible for it.',
    });
  }
}
