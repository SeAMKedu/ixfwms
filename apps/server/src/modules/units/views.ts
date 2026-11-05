import {
  hasScope,
  isValidCode,
  normalizeCode,
  type LocationSummary,
  type NetworkEntry,
  type UnitAttention,
  type UnitBrief,
  type UnitDetail,
  type UnitEventView,
  type UnitPurchase,
  type UnitStatus,
  type UpdateUnitInput,
} from '@ixfwms/domain';
import { and, asc, desc, eq, inArray, isNull, like, lte, ne, or, sql } from 'drizzle-orm';
import { many, one, type Db, type Executor } from '../../db/client.js';
import {
  categories,
  loans,
  locations,
  parts,
  reports,
  unitEvents,
  units,
  users,
} from '../../db/schema.js';
import { notFound } from '../../lib/errors.js';
import {
  detail,
  detailsHidden,
  eventValue,
  loanReason,
  personName,
  requireScope,
  type Actor,
} from '../../lib/context.js';
import type { LocationService } from '../locations/locations.js';
import type { LocationRow } from '../locations/store.js';
import type { PartResolver } from '../parts/store.js';
import { loanViews, placeLoans } from '../loans/store.js';

export type UnitRow = typeof units.$inferSelect;

/** Statuses that need someone to look at the unit. */
export const ATTENTION: UnitStatus[] = ['needs_attention', 'broken', 'in_repair', 'lost'];

const today = () => new Date().toISOString().slice(0, 10);

export function eventView(
  e: typeof unitEvents.$inferSelect,
  user: string | null,
  places: Map<string, LocationSummary>,
): UnitEventView {
  return {
    id: e.id,
    kind: e.kind,
    text: e.kind === 'lent' ? loanReason(e.text) : detail(e.text),
    value: eventValue(e.kind, e.value),
    from: e.fromLocationId ? (places.get(e.fromLocationId) ?? null) : null,
    to: e.toLocationId ? (places.get(e.toLocationId) ?? null) : null,
    by: personName(user ?? e.reporterName),
    guest: !user,
    at: e.at,
  };
}

export function purchaseOf(
  u: Pick<
    typeof units.$inferSelect,
    'purchaseDate' | 'purchaseValueCents' | 'costCenter' | 'usefulLifeYears'
  >,
): UnitPurchase {
  return {
    date: u.purchaseDate,
    valueCents: u.purchaseValueCents,
    costCenter: u.costCenter,
    usefulLifeYears: u.usefulLifeYears,
  };
}

/** Members see what things cost; nobody else does. */
export function purchaseFor(
  u: typeof units.$inferSelect,
  actor: Actor | null,
): UnitPurchase | null {
  return actor && hasScope(actor.scopes, 'inventory') ? purchaseOf(u) : null;
}

/** The purchase details an update changes; what it leaves out stays as it is. */
export function purchasePatch(input: UpdateUnitInput): Partial<typeof units.$inferSelect> {
  const patch: Partial<typeof units.$inferSelect> = {};
  if (input.purchaseDate !== undefined) patch.purchaseDate = input.purchaseDate ?? null;
  if (input.purchaseValueCents !== undefined)
    patch.purchaseValueCents = input.purchaseValueCents ?? null;
  if (input.costCenter !== undefined) patch.costCenter = input.costCenter ?? null;
  if (input.usefulLifeYears !== undefined) patch.usefulLifeYears = input.usefulLifeYears ?? null;
  return patch;
}

/** Sorts IPv4 addresses numerically ("10.0.0.9" before "10.0.0.10"); others after them, as text. */
export function ipKey(ip: string | null): string {
  if (!ip) return '~';
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip.trim());
  return m
    ? m
        .slice(1)
        .map((n) => n.padStart(3, '0'))
        .join('.')
    : `~${ip}`;
}

/** Reading units: one unit's page, briefs for lists, what needs attention, the network list. */
export class UnitViews {
  constructor(
    protected readonly db: Db,
    protected readonly locations: LocationService,
    protected readonly parts: PartResolver,
  ) {}

  async resolve(ref: string, ex: Executor = this.db): Promise<UnitRow> {
    const code = normalizeCode(ref);
    const row = isValidCode(code)
      ? await one(ex.select().from(units).where(eq(units.code, code)))
      : undefined;
    const found = row ?? (await one(ex.select().from(units).where(eq(units.id, ref))));
    if (!found) throw notFound('unit', ref);
    return found;
  }

  async detail(ref: string, actor: Actor | null): Promise<UnitDetail> {
    const unit = await this.resolve(ref);
    const [brief] = await this.briefs([unit]);
    const part = await one(
      this.db
        .select({
          id: parts.id,
          code: parts.code,
          name: parts.name,
          kind: parts.kind,
          category: categories.path,
        })
        .from(parts)
        .leftJoin(categories, eq(categories.id, parts.categoryId))
        .where(eq(parts.id, unit.partId)),
    );
    const events = await many(
      this.db
        .select({ e: unitEvents, user: users.name })
        .from(unitEvents)
        .leftJoin(users, eq(users.id, unitEvents.userId))
        .where(eq(unitEvents.unitId, unit.id))
        .orderBy(desc(unitEvents.at), desc(unitEvents.id))
        .limit(100),
    );
    const placeIds = [
      ...new Set(
        events
          .flatMap(({ e }) => [e.fromLocationId, e.toLocationId])
          .filter((x): x is string => !!x),
      ),
    ];
    const places = await this.placeSummaries(placeIds);
    const firmware = !detailsHidden() && events.find(({ e }) => e.kind === 'firmware' && e.value);
    const loanRows = await many(
      this.db.select().from(loans).where(eq(loans.unitId, unit.id)).orderBy(desc(loans.outAt)),
    );
    const openReports = await many(
      this.db
        .select({ r: reports, user: users.name })
        .from(reports)
        .leftJoin(users, eq(users.id, reports.userId))
        .where(
          and(
            eq(reports.ownerType, 'unit'),
            eq(reports.ownerId, unit.id),
            isNull(reports.resolvedAt),
          ),
        )
        .orderBy(desc(reports.createdAt)),
    );
    const hidden = actor == null;
    const location = await this.locations.resolve(unit.locationId);
    const home = unit.homeLocationId ? await this.locations.resolve(unit.homeLocationId) : null;
    return {
      ...brief!,
      part: part!,
      path: await this.locations.pathOf(location),
      homePath: home ? await this.locations.pathOf(home) : [],
      ipAddress: hidden ? null : unit.ipAddress,
      hostname: hidden ? null : unit.hostname,
      macAddress: hidden ? null : unit.macAddress,
      networkHidden: hidden && !!(unit.ipAddress || unit.hostname || unit.macAddress),
      purchase: purchaseFor(unit, actor),
      notes: detail(unit.notes),
      nextCheckAt: unit.nextCheckAt,
      checkDue: !!unit.nextCheckAt && unit.nextCheckAt <= today(),
      firmware: firmware ? { version: firmware.e.value!, at: firmware.e.at } : null,
      createdAt: unit.createdAt,
      events: events.map(({ e, user }) => eventView(e, user, places)),
      loans: await loanViews(this.db, loanRows),
      reports: openReports.map(({ r, user }) => ({
        id: r.id,
        owner: 'unit' as const,
        target: { code: unit.code, name: brief!.name },
        kind: r.kind,
        note: detail(r.note),
        by: personName(user ?? r.reporterName),
        guest: !user,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
        resolvedBy: null,
        resolution: detail(r.resolution),
      })),
    };
  }

  /** Units of these items, for item lists and pages. */
  async briefsForParts(
    partIds: string[],
    ex: Executor = this.db,
  ): Promise<Map<string, UnitBrief[]>> {
    const out = new Map<string, UnitBrief[]>();
    if (!partIds.length) return out;
    const rows = await many(
      ex.select().from(units).where(inArray(units.partId, partIds)).orderBy(asc(units.id)),
    );
    const briefs = await this.briefs(rows, ex);
    rows.forEach((r, i) => out.set(r.partId, [...(out.get(r.partId) ?? []), briefs[i]!]));
    return out;
  }

  /** Units at a place or (recursive) anywhere inside it. */
  async at(
    loc: LocationRow,
    recursive: boolean,
  ): Promise<(UnitBrief & { part: { code: string; name: string }; in: LocationSummary | null })[]> {
    const rows = await many(
      this.db
        .select({ u: units, partCode: parts.code, partName: parts.name })
        .from(units)
        .innerJoin(parts, eq(parts.id, units.partId))
        .innerJoin(locations, eq(locations.id, units.locationId))
        .where(recursive ? like(locations.path, `${loc.path}%`) : eq(units.locationId, loc.id))
        .orderBy(asc(parts.name)),
    );
    const briefs = await this.briefs(rows.map((r) => r.u));
    return rows.map((r, i) => ({
      ...briefs[i]!,
      part: { code: r.partCode, name: r.partName },
      in: r.u.locationId === loc.id ? null : briefs[i]!.location,
    }));
  }

  /** Units that are broken, reported, in repair, or due for a check. */
  async attention(): Promise<UnitAttention[]> {
    const rows = await many(
      this.db
        .select({ u: units, code: parts.code, name: parts.name })
        .from(units)
        .innerJoin(parts, eq(parts.id, units.partId))
        .where(
          and(
            ne(units.status, 'archived'),
            or(inArray(units.status, ATTENTION), lte(units.nextCheckAt, today())),
          ),
        )
        .orderBy(asc(units.nextCheckAt)),
    );
    const briefs = await this.briefs(rows.map((r) => r.u));
    return rows.map((r, i) => ({
      unit: briefs[i]!,
      part: { code: r.code, name: r.name },
      reason: ATTENTION.includes(r.u.status) ? ('status' as const) : ('check_due' as const),
      nextCheckAt: r.u.nextCheckAt,
    }));
  }

  /** The lab's network list, made from the units' network details. Logged-in users only. */
  async network(actor: Actor | null): Promise<NetworkEntry[]> {
    requireScope(actor, 'read');
    const rows = await many(
      this.db
        .select({ u: units, code: parts.code, name: parts.name })
        .from(units)
        .innerJoin(parts, eq(parts.id, units.partId))
        .where(
          or(
            sql`coalesce(${units.ipAddress}, '') <> ''`,
            sql`coalesce(${units.hostname}, '') <> ''`,
            sql`coalesce(${units.macAddress}, '') <> ''`,
          ),
        ),
    );
    const briefs = await this.briefs(rows.map((r) => r.u));
    return rows
      .map((r, i) => ({
        unit: { code: r.u.code, name: briefs[i]!.name },
        part: { code: r.code, name: r.name },
        ipAddress: r.u.ipAddress,
        hostname: r.u.hostname,
        macAddress: r.u.macAddress,
        place: briefs[i]!.location.address || briefs[i]!.location.name,
      }))
      .sort((a, b) => ipKey(a.ipAddress).localeCompare(ipKey(b.ipAddress)));
  }

  async briefs(rows: UnitRow[], ex: Executor = this.db): Promise<UnitBrief[]> {
    if (!rows.length) return [];
    const partNames = new Map(
      (
        await many(
          ex
            .select({ id: parts.id, name: parts.name })
            .from(parts)
            .where(inArray(parts.id, [...new Set(rows.map((r) => r.partId))])),
        )
      ).map((p) => [p.id, p.name]),
    );
    const placeRows = await many(
      ex
        .select()
        .from(locations)
        .where(
          inArray(locations.id, [
            ...new Set(
              rows.flatMap((r) => [r.locationId, r.homeLocationId]).filter((x): x is string => !!x),
            ),
          ]),
        ),
    );
    const rowById = new Map(placeRows.map((p) => [p.id, p]));
    const summaryById = new Map(
      (await this.locations.summaries(ex, placeRows)).map((s) => [s.id, s]),
    );
    const loanRows = await many(
      ex
        .select()
        .from(loans)
        .where(
          and(
            inArray(
              loans.unitId,
              rows.map((r) => r.id),
            ),
            isNull(loans.returnedAt),
          ),
        ),
    );
    const loanViewsByUnit = new Map(
      (await loanViews(ex, loanRows)).map((v, i) => [loanRows[i]!.unitId, v]),
    );
    // Units inside a container lent out are out with it.
    const withPlace = await placeLoans(ex, placeRows);
    return rows.map((r) => {
      const here = rowById.get(r.locationId)!;
      const home = r.homeLocationId ? rowById.get(r.homeLocationId) : undefined;
      return {
        id: r.id,
        code: r.code,
        name: r.name ?? `${partNames.get(r.partId) ?? '?'} ${r.code}`,
        ownName: r.name,
        serialNo: detail(r.serialNo),
        status: r.status,
        location: summaryById.get(r.locationId)!,
        home: home ? summaryById.get(home.id)! : null,
        atHome: !!home && here.path.startsWith(home.path),
        loan: loanViewsByUnit.get(r.id) ?? withPlace.get(r.locationId) ?? null,
        lastSeenAt: r.lastSeenAt,
      };
    });
  }

  protected async placeSummaries(ids: string[]): Promise<Map<string, LocationSummary>> {
    if (!ids.length) return new Map();
    const rows = await many(this.db.select().from(locations).where(inArray(locations.id, ids)));
    return new Map((await this.locations.summaries(this.db, rows)).map((s) => [s.id, s]));
  }
}
