import {
  fold,
  formatAmount,
  MakeBuildInput,
  normalizeCode,
  USABLE_UNIT_STATUSES,
  type BuildBrief,
  type DismantleInput,
  type DismantleResult,
  type LocationDetail,
  type MakeBuildResult,
  type SearchKind,
} from '@ixfwms/domain';
import { and, asc, count, eq, inArray, like, or } from 'drizzle-orm';
import { many, one, type Db, type Executor } from '../db/client.js';
import {
  locations,
  locationTypes,
  parts,
  stockLots,
  stockMovements,
  unitEvents,
  units,
} from '../db/schema.js';
import { invalid } from '../lib/errors.js';
import { nowIso } from '../lib/ids.js';
import { audit, requireScope, type Actor } from './context.js';
import type { LocationRow, LocationService } from './locations.js';
import type { OpenActionService } from './open.js';
import type { PartResolver } from './parts.js';
import type { StockService } from './stock.js';
import type { UnitService } from './units.js';

/**
 * Builds: places that are things made from parts (a gripper, a test rig). Parts go in by
 * ordinary moves and keep where they came from, so dismantling can put them back.
 */
export class BuildService {
  constructor(
    private readonly db: Db,
    private readonly locations: LocationService,
    private readonly stock: StockService,
    private readonly units: UnitService,
    private readonly open: OpenActionService,
    private readonly resolver: PartResolver,
  ) {}

  /**
   * Makes a build and moves the listed parts into it from free stock: counted stock by count,
   * weighed stock by count × piece mass, units one by one. The rest is listed to do by hand.
   */
  async make(input: MakeBuildInput, actor: Actor | null): Promise<MakeBuildResult> {
    const who = requireScope(actor, 'inventory');
    const { lines, ...place } = MakeBuildInput.parse(input);
    return this.db.transaction(async (tx) => {
      const row = await this.locations.createWithin(tx, place, who);
      const build = await this.locations.summarize(tx, row);
      if (!build.build) throw invalid('builds.notBuild', { name: row.name });
      const result: MakeBuildResult = { build, moved: [], left: [] };
      for (const line of lines) {
        const part = await this.resolver.resolve(line.part, tx).catch(() => null);
        if (!part) {
          result.left.push({ name: line.part, quantity: line.quantity, reason: 'unknown' });
          continue;
        }
        const { need, byHand } =
          part.tracking === 'individual'
            ? await this.putUnits(tx, part.id, row, line.quantity, who, result)
            : await this.putStock(tx, part, row, line.quantity, who, result);
        if (need > 0)
          result.left.push({
            name: part.name,
            quantity: need,
            reason: byHand ? 'byHand' : 'short',
          });
      }
      await audit(tx, who, 'make-build', 'location', row.id, {
        lines: lines.length,
        left: result.left.length,
      });
      return result;
    });
  }

  private async putUnits(
    tx: Executor,
    partId: string,
    build: LocationRow,
    wanted: number,
    who: Actor,
    result: MakeBuildResult,
  ): Promise<{ need: number; byHand: boolean }> {
    const rows = await many(
      tx
        .select()
        .from(units)
        .where(and(eq(units.partId, partId), inArray(units.status, USABLE_UNIT_STATUSES)))
        .orderBy(asc(units.name), asc(units.code)),
    );
    const briefs = await this.units.briefs(rows, tx);
    let need = wanted;
    for (const [i, unit] of rows.entries()) {
      const brief = briefs[i]!;
      if (need === 0) break;
      if (brief.loan || brief.location.inBuild || brief.location.kind !== 'normal') continue;
      await this.units.moveWithin(tx, unit, build.id, who);
      result.moved.push({
        name: brief.name,
        display: formatAmount({ mode: 'count', quantity: 1, unit: null, level: null }),
        from: brief.location,
      });
      need--;
    }
    return { need, byHand: false };
  }

  private async putStock(
    tx: Executor,
    part: { id: string; name: string; unitMassG: number | null },
    build: LocationRow,
    wanted: number,
    who: Actor,
    result: MakeBuildResult,
  ): Promise<{ need: number; byHand: boolean }> {
    const lots = (await this.stock.lotsOfPart(part.id, tx)).filter(
      (l) => !l.location.inBuild && l.location.kind !== 'in_transit' && l.location.kind !== 'away',
    );
    // Counted stock first, the largest lots first, so a list takes from as few places as it can.
    const pieces = (l: (typeof lots)[number]) =>
      l.amount.mode === 'count'
        ? (l.amount.quantity ?? 0)
        : l.amount.mode === 'measure' && l.amount.unit === 'g' && part.unitMassG
          ? Math.floor((l.amount.quantity ?? 0) / part.unitMassG)
          : 0;
    lots.sort(
      (a, b) =>
        Number(b.amount.mode === 'count') - Number(a.amount.mode === 'count') ||
        pieces(b) - pieces(a),
    );
    let need = wanted;
    let byHand = false;
    for (const lot of lots) {
      if (need === 0) break;
      const have = pieces(lot);
      if (have === 0) {
        // Levels, lengths, stock nobody has counted: someone has to take it by hand.
        if (lot.amount.quantity == null || lot.amount.mode !== 'count') byHand = true;
        continue;
      }
      const take = Math.min(need, have);
      const amount =
        lot.amount.mode === 'count'
          ? take
          : Math.min(lot.amount.quantity!, Math.round(take * part.unitMassG! * 10) / 10);
      await this.stock.moveWithin(tx, lot.id, build.id, amount, who);
      result.moved.push({
        name: part.name,
        display: formatAmount({ ...lot.amount, quantity: amount }),
        from: lot.location,
      });
      need -= take;
    }
    return { need, byHand };
  }

  /**
   * Takes a build apart: everything back where it came from (`to` empty), or everything onto
   * `to` (a workstation, to sort first). Once nothing is left in it, it's marked dismantled.
   */
  async dismantle(
    ref: string,
    input: DismantleInput,
    actor: Actor | null,
  ): Promise<DismantleResult> {
    const who = requireScope(actor, 'inventory');
    return this.db.transaction(async (tx) => {
      const build = await this.locations.resolve(ref, tx);
      const summary = await this.locations.summarize(tx, build);
      if (!summary.build) throw invalid('builds.notBuild', { name: build.name });
      if (build.dismantledAt) throw invalid('builds.alreadyDismantled', { name: build.name });
      const moved = input.to
        ? await this.moveAll(tx, build, input.to, who)
        : await this.open.sendBack(tx, build, who, null);
      const empty = await this.isEmpty(tx, build);
      if (empty) {
        await tx
          .update(locations)
          .set({ dismantledAt: nowIso(), updatedAt: nowIso() })
          .where(eq(locations.id, build.id));
        await audit(tx, who, 'dismantle', 'location', build.id, { to: input.to ?? null });
      }
      return { ...moved, dismantled: empty };
    });
  }

  /** Everything in the build, places inside it too, onto `toRef`. */
  private async moveAll(
    tx: Executor,
    build: LocationRow,
    toRef: string,
    who: Actor,
  ): Promise<DismantleResult> {
    const dest = await this.locations.resolve(toRef, tx);
    if (dest.path.startsWith(build.path) || dest.kind === 'in_transit')
      throw invalid('builds.outside', { name: build.name });
    this.units.checkDestination(dest);
    const to = await this.locations.summarize(tx, dest);
    const result: DismantleResult = { returned: [], left: [], dismantled: false };
    const unitRows = await this.units.directlyAt(build.id, tx);
    const briefs = await this.units.briefs(unitRows, tx);
    for (const [i, unit] of unitRows.entries()) {
      await this.units.moveWithin(tx, unit, dest.id, who);
      result.returned.push({ kind: 'unit', name: briefs[i]!.name, to });
    }
    for (const { lot, name } of await many(
      tx
        .select({ lot: stockLots, name: parts.name })
        .from(stockLots)
        .innerJoin(parts, eq(parts.id, stockLots.partId))
        .where(eq(stockLots.locationId, build.id)),
    )) {
      await this.stock.moveWithin(tx, lot.id, dest.id, null, who);
      result.returned.push({ kind: 'lot', name, to });
    }
    for (const box of await many(
      tx.select().from(locations).where(eq(locations.parentId, build.id)),
    ))
      await this.locations.moveWithin(tx, box, dest.id, who);
    return result;
  }

  /** Nothing left in it: no stock, no units (retired ones too), no places inside. */
  private async isEmpty(tx: Executor, build: LocationRow): Promise<boolean> {
    const lots = await one(
      tx.select({ n: count() }).from(stockLots).where(eq(stockLots.locationId, build.id)),
    );
    const here = await one(
      tx.select({ n: count() }).from(units).where(eq(units.locationId, build.id)),
    );
    const inside = await one(
      tx.select({ n: count() }).from(locations).where(eq(locations.parentId, build.id)),
    );
    return !lots?.n && !here?.n && !inside?.n;
  }

  /**
   * Builds for search: those the text matches (name, description, code; dismantled ones too,
   * marked), or for the Builds filter without text, every build still standing.
   */
  async find(q: string | undefined, kind: SearchKind | undefined): Promise<BuildBrief[]> {
    if (kind && kind !== 'build') return [];
    if (!q && kind !== 'build') return [];
    const rows = await many(
      this.db
        .select({ loc: locations })
        .from(locations)
        .innerJoin(locationTypes, eq(locationTypes.id, locations.typeId))
        .where(eq(locationTypes.build, true))
        .orderBy(asc(locations.name)),
    );
    const text = q ? fold(q) : '';
    const code = q ? normalizeCode(q) : '';
    const found = rows
      .map((r) => r.loc)
      .filter((l) =>
        text
          ? fold(`${l.name} ${l.description ?? ''}`).includes(text) || l.code === code
          : !l.dismantledAt,
      )
      .sort((a, b) => Number(!!a.dismantledAt) - Number(!!b.dismantledAt));
    return Promise.all(found.map((l) => this.brief(l)));
  }

  private async brief(loc: LocationRow): Promise<BuildBrief> {
    const summary = await this.locations.summarize(this.db, loc);
    const parent = loc.parentId ? await this.locations.resolve(loc.parentId) : null;
    const within = like(locations.path, `${loc.path}%`);
    const lots = await one(
      this.db
        .select({ n: count() })
        .from(stockLots)
        .innerJoin(locations, eq(locations.id, stockLots.locationId))
        .where(within),
    );
    const here = await one(
      this.db
        .select({ n: count() })
        .from(units)
        .innerJoin(locations, eq(locations.id, units.locationId))
        .where(within),
    );
    return {
      ...summary,
      description: loc.description,
      contact: loc.contact,
      in: parent && (await this.locations.summarize(this.db, parent)),
      items: Number(lots?.n ?? 0) + Number(here?.n ?? 0),
    };
  }

  /** Every part and unit that has been in the build, from the stock and unit history. */
  async wasInIt(loc: LocationRow): Promise<LocationDetail['wasInIt']> {
    const touched = or(
      eq(stockMovements.toLocationId, loc.id),
      eq(stockMovements.fromLocationId, loc.id),
    );
    const partRows = await many(
      this.db
        .selectDistinct({ code: parts.code, name: parts.name })
        .from(stockMovements)
        .innerJoin(parts, eq(parts.id, stockMovements.partId))
        .where(touched)
        .orderBy(asc(parts.name)),
    );
    const unitRows = await many(
      this.db
        .selectDistinct({ u: units })
        .from(unitEvents)
        .innerJoin(units, eq(units.id, unitEvents.unitId))
        .where(eq(unitEvents.toLocationId, loc.id)),
    );
    const briefs = await this.units.briefs(unitRows.map((r) => r.u));
    return [
      ...partRows.map((p) => ({ kind: 'part' as const, ...p })),
      ...briefs.map((u) => ({ kind: 'unit' as const, code: u.code, name: u.name })),
    ];
  }
}
