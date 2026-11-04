import type { LocationSummary, OverduePlace } from '@ixfwms/domain';
import { eq } from 'drizzle-orm';
import { many, type Db } from '../db/client.js';
import { locations } from '../db/schema.js';
import { audit, personName, requireScope, type Actor } from './context.js';
import type { LocationService } from './locations.js';

/**
 * Temporary places (a workstation, a project corner): an expected stay that runs out when
 * nothing happens there. Reached through LocationService.
 */
export class TemporaryPlaces {
  constructor(
    private readonly db: Db,
    private readonly locations: LocationService,
  ) {}

  /** "Still needed": restarts a temporary place's clock. */
  async stillNeeded(ref: string, actor: Actor | null): Promise<LocationSummary> {
    const who = requireScope(actor, 'inventory');
    const loc = await this.locations.resolve(ref);
    await this.locations.touch(this.db, [loc.id]);
    await audit(this.db, who, 'still-needed', 'location', loc.id);
    return this.locations.summarize(this.db, await this.locations.resolve(loc.id));
  }

  /** Temporary places left untouched longer than expected, longest overdue first. */
  async overdue(): Promise<OverduePlace[]> {
    const rows = await many(this.db.select().from(locations).where(eq(locations.kind, 'normal')));
    const summaries = await this.locations.summaries(this.db, rows);
    const late = summaries
      .map((s, i) => ({ s, row: rows[i]! }))
      .filter(({ s }) => s.overdue)
      .sort((a, b) => a.s.dueAt!.localeCompare(b.s.dueAt!));
    return Promise.all(
      late.map(async ({ s, row }) => ({
        place: s,
        path: await this.locations.pathOf(row),
        contact: personName(row.contact),
        lastActivityAt: row.lastActivityAt ?? row.updatedAt,
      })),
    );
  }
}
