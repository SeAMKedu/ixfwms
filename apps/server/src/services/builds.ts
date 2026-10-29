import {
  AddToBuildInput,
  formatAmount,
  MakeBuildInput,
  type AddToBuildResult,
  type BuildBrief,
  type DismantleInput,
  type DismantleResult,
  type LocationDetail,
  type MakeBuildResult,
} from '@ixfwms/domain';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, like, or } from 'drizzle-orm';
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
import { countAmount, cutAmount } from './amounts.js';
import { BuildFill } from './build-fill.js';

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
  ) {
    this.fill = new BuildFill(stock, units);
  }

  /** Taking stock and units into a build. */
  private readonly fill: BuildFill;

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
        const need =
          part.tracking === 'individual'
            ? await this.fill.putUnits(tx, part.id, row, line.quantity, who, result)
            : await this.fill.putStock(tx, part, row, line.quantity, who, result, {
                size: line.size,
              });
        if (need > 0)
          result.left.push({
            name: part.name,
            quantity: need,
            reason: 'short',
          });
      }
      await audit(tx, who, 'make-build', 'location', row.id, {
        lines: lines.length,
        left: result.left.length,
      });
      return result;
    });
  }

  /**
   * Puts an item into a build from free stock: from the lot or unit `from`, or the fullest free
   * stock first. What free stock can't cover is added as new stock with `restAsNew` (bought new,
   * or from someone's pocket), otherwise listed. Units can't be made up that way.
   */
  async addParts(
    ref: string,
    input: AddToBuildInput,
    actor: Actor | null,
  ): Promise<AddToBuildResult> {
    const who = requireScope(actor, 'inventory');
    const {
      part: partRef,
      quantity,
      from,
      restAsNew,
      size,
      leftover,
    } = AddToBuildInput.parse(input);
    return this.db.transaction(async (tx) => {
      const build = this.locations.checkOpen(await this.locations.resolve(ref, tx));
      if (!(await this.locations.summarize(tx, build)).build)
        throw invalid('builds.notBuild', { name: build.name });
      const part = await this.resolver.resolve(partRef, tx);
      const result: AddToBuildResult = { moved: [], left: [], added: null };
      const individual = part.tracking === 'individual';
      const need = individual
        ? await this.fill.putUnits(tx, part.id, build, quantity, who, result, from ?? null)
        : await this.fill.putStock(tx, part, build, quantity, who, result, {
            from,
            size,
            leftover,
          });
      if (need > 0 && restAsNew && !individual) {
        const amount = size
          ? cutAmount(Array.from({ length: need }, () => size))
          : countAmount(need);
        await this.stock.addWithin(tx, part.id, build.id, amount, who, null);
        result.added = formatAmount(amount);
      } else if (need > 0) result.left.push({ name: part.name, quantity: need, reason: 'short' });
      await audit(tx, who, 'add-to-build', 'location', build.id, { part: part.code, quantity });
      return result;
    });
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

  /** Nothing left in it: no stock, no units (archived ones too), no places inside. */
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

  /** Builds by id, in the order given (search results). */
  async briefs(ids: string[]): Promise<BuildBrief[]> {
    if (!ids.length) return [];
    const rows = await many(this.db.select().from(locations).where(inArray(locations.id, ids)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return Promise.all(ids.map((id) => this.brief(byId.get(id)!)));
  }

  /** The Builds page: standing builds by name, or the dismantled ones, latest first. */
  async list(dismantled: boolean): Promise<BuildBrief[]> {
    const rows = await many(
      this.db
        .select({ loc: locations })
        .from(locations)
        .innerJoin(locationTypes, eq(locationTypes.id, locations.typeId))
        .where(
          and(
            eq(locationTypes.build, true),
            dismantled ? isNotNull(locations.dismantledAt) : isNull(locations.dismantledAt),
          ),
        )
        .orderBy(dismantled ? desc(locations.dismantledAt) : asc(locations.name)),
    );
    return Promise.all(rows.map((r) => this.brief(r.loc)));
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
