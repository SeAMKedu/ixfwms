import { formatAmount, type LocationDetail } from '@ixfwms/domain';
import { and, asc, eq, inArray, isNotNull, like, sql } from 'drizzle-orm';
import { many, one, type Db } from '../db/client.js';
import { locations, locationTypes, parts, stockLots } from '../db/schema.js';
import type { BuildService } from './builds.js';
import type { FileService } from './files.js';
import type { LoanService } from './loans.js';
import type { LocationService } from './locations.js';
import type { PartService } from './parts.js';
import type { UnitService } from './units.js';

/** Read model for a location page: path, sub-locations and what's stored there. */
export class LocationViews {
  constructor(
    private readonly db: Db,
    private readonly locations: LocationService,
    private readonly parts: PartService,
    private readonly files: FileService,
    private readonly units: UnitService,
    private readonly builds: BuildService,
    private readonly loans: LoanService,
  ) {}

  async detail(ref: string, opts: { recursive?: boolean } = {}): Promise<LocationDetail> {
    const loc = await this.locations.resolve(ref);
    const path = await this.locations.pathOf(loc);
    const children = await this.locations.children(loc.id);
    const counts = new Map<string, number>();
    for (const child of children) {
      const childRow = await this.locations.resolve(child.id);
      const n = await one(
        this.db
          .select({ n: sql<number>`count(distinct ${stockLots.partId})` })
          .from(stockLots)
          .innerJoin(locations, eq(locations.id, stockLots.locationId))
          .where(like(locations.path, `${childRow.path}%`)),
      );
      counts.set(child.id, Number(n?.n ?? 0));
    }

    const lots = await many(
      this.db
        .select({ lot: stockLots, locId: locations.id })
        .from(stockLots)
        .innerJoin(locations, eq(locations.id, stockLots.locationId))
        .where(
          opts.recursive ? like(locations.path, `${loc.path}%`) : eq(stockLots.locationId, loc.id),
        ),
    );
    const partIds = [...new Set(lots.map((l) => l.lot.partId))];
    const partRows = partIds.length
      ? await many(this.db.select().from(parts).where(inArray(parts.id, partIds)))
      : [];
    const partById = new Map(partRows.map((p) => [p.id, p]));
    const subLocIds = [...new Set(lots.map((l) => l.locId).filter((id) => id !== loc.id))];
    const subLocs = subLocIds.length
      ? await this.locations.summaries(
          this.db,
          await many(this.db.select().from(locations).where(inArray(locations.id, subLocIds))),
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
    return {
      ...summary,
      description: loc.description,
      hint: loc.hint,
      numberFrom: loc.numberFrom,
      path,
      children: children.map((c) => ({ ...c, partCount: counts.get(c.id) ?? 0 })),
      archived: await this.locations.summaries(
        this.db,
        await many(
          this.db
            .select()
            .from(locations)
            .where(and(eq(locations.parentId, loc.id), isNotNull(locations.archivedAt)))
            .orderBy(asc(locations.name)),
        ),
      ),
      contents,
      units: await this.units.at(loc, opts.recursive ?? false),
      attachments: await this.files.attachmentsOf('location', loc.id),
      clashes: await this.locations.clashes(loc),
      loan: await this.loans.ofPlace(loc),
      ownStayDays: loc.stayDays,
      typeStayDays:
        (
          await one(
            this.db
              .select({ stayDays: locationTypes.stayDays })
              .from(locationTypes)
              .where(eq(locationTypes.id, loc.typeId)),
          )
        )?.stayDays ?? null,
      contact: loc.contact,
      lastActivityAt: loc.lastActivityAt ?? loc.updatedAt,
      createdAt: loc.createdAt,
      wasInIt: summary.build ? await this.builds.wasInIt(loc) : [],
    };
  }
}
