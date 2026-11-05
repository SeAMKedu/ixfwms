import {
  normalizeCode,
  isValidCode,
  type AddUnitsInput,
  type LocationSummary,
  type NetworkEntry,
  type UnitAttention,
  type UnitBrief,
  type UnitDetail,
  type UnitEventKind,
  type UnitLogInput,
  type UnitStatus,
  type UpdateUnitInput,
  AddUnitsInput as AddUnitsSchema,
} from '@ixfwms/domain';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  like,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { many, one, type Db, type Executor } from '../db/client.js';
import {
  categories,
  loans,
  locations,
  parts,
  reports,
  stockLots,
  unitEvents,
  units,
  users,
} from '../db/schema.js';
import { invalid, notFound } from '../lib/errors.js';
import { newId, nowIso } from '../lib/ids.js';
import { allocateCode, claimCode } from './codes.js';
import {
  audit,
  detail,
  detailsHidden,
  personName,
  requireScope,
  type Actor,
} from '../lib/context.js';
import type { LocationRow, LocationService } from './locations.js';
import type { PartResolver } from './parts.js';
import { unitSearchText } from './search-text.js';
import { checkNotLent } from '../modules/loans/rules.js';
import { loanViews, openLoan, placeLoans } from '../modules/loans/store.js';
import { eventView, ipKey, purchaseFor, purchasePatch } from './unit-views.js';

export type UnitRow = typeof units.$inferSelect;

/** Statuses that need someone to look at the unit. */
const ATTENTION: UnitStatus[] = ['needs_attention', 'broken', 'in_repair', 'lost'];

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Individually tracked things: each has its own code, where it is now and where it belongs,
 * a log (moves, maintenance, firmware) and a status. Lending them is LoanService.
 */
export class UnitService {
  constructor(
    private readonly db: Db,
    private readonly locations: LocationService,
    private readonly parts: PartResolver,
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

  /** Adds units to an individually tracked item. An item without stock switches to individual by itself. */
  async add(input: AddUnitsInput, actor: Actor | null): Promise<UnitBrief[]> {
    const who = requireScope(actor, 'inventory');
    const { part: partRef, units: entries, location, home } = AddUnitsSchema.parse(input);
    const ids = await this.db.transaction(async (tx) => {
      const part = await this.parts.resolve(partRef, tx);
      if (part.tracking !== 'individual') {
        const lot = await one(
          tx
            .select({ id: stockLots.id })
            .from(stockLots)
            .where(eq(stockLots.partId, part.id))
            .limit(1),
        );
        if (lot) throw invalid('parts.hasAmounts', { name: part.name });
        await tx
          .update(parts)
          .set({ tracking: 'individual', updatedAt: nowIso() })
          .where(eq(parts.id, part.id));
      }
      const homeRow = home ? await this.locations.resolve(home, tx) : null;
      const where = location
        ? await this.locations.resolve(location, tx)
        : (homeRow ?? (await this.locations.inbox(tx)));
      await this.checkDestination(where, tx);
      const created: string[] = [];
      for (const entry of entries) {
        const id = newId();
        await tx.insert(units).values({
          id,
          code: entry.code ? await claimCode(tx, entry.code) : await allocateCode(tx),
          partId: part.id,
          name: entry.name ?? null,
          serialNo: entry.serialNo ?? null,
          searchText: unitSearchText({
            name: entry.name ?? null,
            serialNo: entry.serialNo ?? null,
          }),
          ipAddress: entry.ipAddress ?? null,
          hostname: entry.hostname ?? null,
          macAddress: entry.macAddress ?? null,
          notes: entry.notes ?? null,
          locationId: where.id,
          homeLocationId: homeRow?.id ?? null,
          lastSeenAt: nowIso(),
        });
        await this.event(tx, id, 'created', { to: where.id, who });
        await this.locations.touch(tx, [where.id]);
        created.push(id);
      }
      await audit(tx, who, 'create', 'unit', part.id, { count: created.length });
      return created;
    });
    // Ids are time-ordered, so this is the order they were given in.
    return this.briefs(
      await many(this.db.select().from(units).where(inArray(units.id, ids)).orderBy(asc(units.id))),
    );
  }

  async update(ref: string, input: UpdateUnitInput, actor: Actor | null): Promise<UnitDetail> {
    const who = requireScope(actor, 'inventory');
    const id = await this.db.transaction(async (tx) => {
      const unit = await this.resolve(ref, tx);
      const patch: Partial<UnitRow> = { updatedAt: nowIso() };
      for (const key of [
        'name',
        'serialNo',
        'ipAddress',
        'hostname',
        'macAddress',
        'notes',
        'nextCheckAt',
      ] as const) {
        if (input[key] !== undefined) patch[key] = input[key] ?? null;
      }
      Object.assign(patch, purchasePatch(input));
      if (patch.name !== undefined || patch.serialNo !== undefined)
        patch.searchText = unitSearchText({ ...unit, ...patch });
      if (input.home !== undefined)
        patch.homeLocationId = input.home
          ? (await this.locations.resolve(input.home, tx)).id
          : null;
      if (input.status !== undefined && input.status !== unit.status) {
        patch.status = input.status;
        await this.event(tx, unit.id, 'status', { value: input.status, who });
      }
      await tx.update(units).set(patch).where(eq(units.id, unit.id));
      await audit(tx, who, 'update', 'unit', unit.id, { ...input });
      return unit.id;
    });
    return this.detail(id, actor);
  }

  /** Writes an entry in the unit's log; problems and repairs change its status too. */
  async log(ref: string, input: UnitLogInput, actor: Actor | null): Promise<UnitDetail> {
    const who = requireScope(actor, 'inventory');
    if (input.kind === 'firmware' && !input.value) throw invalid('units.giveVersion');
    if (!input.text && !input.value) throw invalid('units.writeSomething');
    const unit = await this.resolve(ref);
    await this.db.transaction(async (tx) => {
      await this.event(tx, unit.id, input.kind, {
        text: input.text ?? null,
        value: input.value ?? null,
        who,
      });
      const patch: Partial<UnitRow> = { lastSeenAt: nowIso(), updatedAt: nowIso() };
      if (input.nextCheckAt !== undefined) patch.nextCheckAt = input.nextCheckAt ?? null;
      if (input.kind === 'problem' && unit.status === 'ok') patch.status = 'needs_attention';
      if (input.kind === 'repaired' && ATTENTION.includes(unit.status)) patch.status = 'ok';
      await tx.update(units).set(patch).where(eq(units.id, unit.id));
    });
    return this.detail(unit.id, actor);
  }

  /** A logged-in move to anywhere except "Out of the lab" (that's lending) or someone's carry list. */
  async move(ref: string, to: string, actor: Actor | null): Promise<UnitDetail> {
    const who = requireScope(actor, 'inventory');
    await this.db.transaction(async (tx) => {
      const unit = await this.resolve(ref, tx);
      const dest = await this.locations.resolve(to, tx);
      await this.checkDestination(dest, tx);
      await this.moveWithin(tx, unit, dest.id, who);
    });
    return this.detail(ref, actor);
  }

  /** Moves a unit inside a transaction; `who` is null (and `guest` the name given) without an account. */
  async moveWithin(
    tx: Executor,
    unit: UnitRow,
    destId: string,
    who: Actor | null,
    guest: string | null = null,
    kind: UnitEventKind = 'moved',
    text: string | null = null,
  ): Promise<void> {
    if (await openLoan(tx, unit.id)) throw invalid('units.lentReturnFirst');
    await checkNotLent(tx, await this.locations.resolve(unit.locationId, tx));
    if (destId === unit.locationId && kind === 'moved') return;
    await tx
      .update(units)
      .set({ locationId: destId, lastSeenAt: nowIso(), updatedAt: nowIso() })
      .where(eq(units.id, unit.id));
    await this.event(tx, unit.id, kind, { from: unit.locationId, to: destId, who, guest, text });
    await this.locations.touch(tx, [unit.locationId, destId]);
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

  /**
   * Units can't be put in "Out of the lab" or a container lent out (lend them), someone's carry
   * list (pick them up) or a dismantled build.
   */
  async checkDestination(dest: LocationRow, ex: Executor = this.db): Promise<void> {
    if (dest.kind === 'in_transit') throw invalid('stock.pickUpToCarry');
    await this.locations.checkOpen(dest, ex);
  }

  async event(
    ex: Executor,
    unitId: string,
    kind: UnitEventKind,
    e: {
      from?: string | null;
      to?: string | null;
      text?: string | null;
      value?: string | null;
      who: Actor | null;
      guest?: string | null;
    },
  ): Promise<void> {
    await ex.insert(unitEvents).values({
      id: newId(),
      unitId,
      kind,
      text: e.text ?? null,
      value: e.value ?? null,
      fromLocationId: e.from ?? null,
      toLocationId: e.to ?? null,
      userId: e.who?.userId ?? null,
      reporterName: e.who ? null : (e.guest ?? null),
    });
  }

  /** Units directly at a place (not inside things there), archived ones left out. */
  async directlyAt(locId: string, ex: Executor = this.db): Promise<UnitRow[]> {
    return many(
      ex
        .select()
        .from(units)
        .where(and(eq(units.locationId, locId), notInArray(units.status, ['archived']))),
    );
  }

  private async placeSummaries(ids: string[]): Promise<Map<string, LocationSummary>> {
    if (!ids.length) return new Map();
    const rows = await many(this.db.select().from(locations).where(inArray(locations.id, ids)));
    return new Map((await this.locations.summaries(this.db, rows)).map((s) => [s.id, s]));
  }
}
