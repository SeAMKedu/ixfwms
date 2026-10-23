import { formatAmount, type LocationDetail } from '@ixfwms/domain';
import { eq, inArray, like, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { locations, parts, stockLots } from '../db/schema.js';
import type { FileService } from './files.js';
import type { LocationService } from './locations.js';
import type { PartService } from './parts.js';

/** Read model for a location page: path, sub-locations and what's stored there. */
export class LocationViews {
  constructor(
    private readonly db: Db,
    private readonly locations: LocationService,
    private readonly parts: PartService,
    private readonly files: FileService,
  ) {}

  async detail(ref: string, opts: { recursive?: boolean } = {}): Promise<LocationDetail> {
    const loc = await this.locations.resolve(ref);
    const path = await this.locations.pathOf(loc);
    const children = await this.locations.children(loc.id);
    const counts = new Map<string, number>();
    for (const child of children) {
      const childRow = await this.locations.resolve(child.id);
      const n = await this.db
        .select({ n: sql<number>`count(distinct ${stockLots.partId})` })
        .from(stockLots)
        .innerJoin(locations, eq(locations.id, stockLots.locationId))
        .where(like(locations.path, `${childRow.path}%`))
        .get();
      counts.set(child.id, Number(n?.n ?? 0));
    }

    const lots = await this.db
      .select({ lot: stockLots, locId: locations.id })
      .from(stockLots)
      .innerJoin(locations, eq(locations.id, stockLots.locationId))
      .where(
        opts.recursive ? like(locations.path, `${loc.path}%`) : eq(stockLots.locationId, loc.id),
      )
      .all();
    const partIds = [...new Set(lots.map((l) => l.lot.partId))];
    const partRows = partIds.length
      ? await this.db.select().from(parts).where(inArray(parts.id, partIds)).all()
      : [];
    const partById = new Map(partRows.map((p) => [p.id, p]));
    const subLocIds = [...new Set(lots.map((l) => l.locId).filter((id) => id !== loc.id))];
    const subLocs = subLocIds.length
      ? await this.locations.summaries(
          this.db,
          await this.db.select().from(locations).where(inArray(locations.id, subLocIds)).all(),
        )
      : [];
    const subById = new Map(subLocs.map((s) => [s.id, s]));

    const contents = lots
      .map(({ lot, locId }) => {
        const p = partById.get(lot.partId)!;
        return {
          lotId: lot.id,
          part: {
            id: p.id,
            code: p.code,
            name: p.name,
            status: p.status,
            manufacturer: p.manufacturer,
          },
          display: formatAmount(lot),
          in: locId === loc.id ? null : (subById.get(locId) ?? null),
        };
      })
      .sort((a, b) => a.part.name.localeCompare(b.part.name));

    const summary = await this.locations.summarize(this.db, loc);
    const summaryType = summary.type;
    return {
      ...summary,
      description: loc.description,
      path,
      children: children.map((c) => ({ ...c, partCount: counts.get(c.id) ?? 0 })),
      contents,
      attachments: await this.files.attachmentsOf('location', loc.id),
      clashes: await this.locations.clashes(loc),
      ownStayDays: loc.stayDays,
      typeStayDays:
        (await this.locations.types()).find((ty) => ty.key === summaryType)?.stayDays ?? null,
      contact: loc.contact,
      lastActivityAt: loc.lastActivityAt ?? loc.updatedAt,
    };
  }
}
