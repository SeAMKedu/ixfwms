import type { LocationSummary } from '@ixfwms/domain';
import { eq } from 'drizzle-orm';
import { one, type Db } from '../db/client.js';
import { locations, locationTypes } from '../db/schema.js';
import { invalid } from '../lib/errors.js';
import { nowIso } from '../lib/ids.js';
import { audit, requireScope, type Actor } from '../lib/context.js';
import { checkEmpty } from './deletes.js';
import type { LocationService } from './locations.js';

/**
 * Putting an old container away, and bringing it back. Archived, it's left out of place lists
 * and pickers and nothing can go in it; its code still scans, and its history stays. Only movable
 * containers (boxes, bins, pallets), and only empty: a room or shelf is deleted or kept, and a
 * build is dismantled. Items and units are archived by their status instead.
 */
export class ArchiveService {
  constructor(
    private readonly db: Db,
    private readonly locations: LocationService,
  ) {}

  async place(ref: string, actor: Actor | null): Promise<LocationSummary> {
    const who = requireScope(actor, 'inventory');
    return this.db.transaction(async (tx) => {
      const loc = await this.locations.resolve(ref, tx);
      if (!loc.archivedAt) {
        const type = await one(
          tx.select().from(locationTypes).where(eq(locationTypes.id, loc.typeId)),
        );
        if (loc.kind !== 'normal' || !type?.movable || type.build)
          throw invalid('places.cantArchive', { name: loc.name });
        await checkEmpty(tx, loc);
        loc.archivedAt = nowIso();
        await tx
          .update(locations)
          .set({ archivedAt: loc.archivedAt, updatedAt: loc.archivedAt })
          .where(eq(locations.id, loc.id));
        await audit(tx, who, 'archive', 'location', loc.id, { code: loc.code });
      }
      return this.locations.summarize(tx, loc);
    });
  }

  async unarchivePlace(ref: string, actor: Actor | null): Promise<LocationSummary> {
    const who = requireScope(actor, 'inventory');
    return this.db.transaction(async (tx) => {
      const loc = await this.locations.resolve(ref, tx);
      if (!loc.archivedAt) throw invalid('places.notArchived', { name: loc.name });
      loc.archivedAt = null;
      await tx
        .update(locations)
        .set({ archivedAt: null, updatedAt: nowIso() })
        .where(eq(locations.id, loc.id));
      await audit(tx, who, 'unarchive', 'location', loc.id, { code: loc.code });
      return this.locations.summarize(tx, loc);
    });
  }
}
