import {
  anonymousAllows,
  type AnonymousActions,
  type ClearResult,
  type LotView,
  type UnitDetail,
} from '@ixfwms/domain';
import { eq } from 'drizzle-orm';
import { many, one, type Db, type Executor } from '../db/client.js';
import { locations, parts, stockLots } from '../db/schema.js';
import { fail, invalid } from '../lib/errors.js';
import { requireScope, type Actor } from './context.js';
import type { LocationService } from './locations.js';
import type { SettingsService } from './settings.js';
import type { StockService } from './stock.js';
import type { UnitService } from './units.js';

/**
 * Moves anyone on the lab network may make, also without an account, as far as the lab's
 * setting allows: putting things back where they belong, and bringing things to a workstation.
 * Logged-in people (the `inventory` scope) may move things anywhere.
 */
export class OpenActionService {
  constructor(
    private readonly db: Db,
    private readonly locations: LocationService,
    private readonly stock: StockService,
    private readonly units: UnitService,
    private readonly settings: SettingsService,
  ) {}

  /** Moves a unit: logged in anywhere; without an account to a workstation or back home. */
  async moveUnit(
    ref: string,
    to: string,
    guest: string | null,
    actor: Actor | null,
  ): Promise<UnitDetail> {
    await this.db.transaction(async (tx) => {
      const unit = await this.units.resolve(ref, tx);
      const dest = await this.locations.resolve(to, tx);
      this.units.checkDestination(dest);
      const summary = await this.locations.summarize(tx, dest);
      const who = await this.allow(
        actor,
        dest.id === unit.homeLocationId ? 'put_back' : 'workstation',
        summary.workstation,
      );
      await this.units.moveWithin(tx, unit, dest.id, who, guest);
    });
    return this.units.detail(ref, actor);
  }

  async putBackUnit(ref: string, guest: string | null, actor: Actor | null): Promise<UnitDetail> {
    const unit = await this.units.resolve(ref);
    if (!unit.homeLocationId) throw invalid('open.noHome');
    return this.moveUnit(unit.id, unit.homeLocationId, guest, actor);
  }

  /** Moves stock (all of a lot or some): logged in anywhere; without an account to a workstation or back. */
  async moveLot(
    lotId: string,
    to: string,
    quantity: number | null,
    guest: string | null,
    actor: Actor | null,
  ): Promise<LotView> {
    return this.db.transaction(async (tx) => {
      const lot = await this.lotRow(lotId, tx);
      const dest = await this.locations.resolve(to, tx);
      if (dest.kind === 'in_transit') throw invalid('stock.pickUpToCarry');
      const summary = await this.locations.summarize(tx, dest);
      const back = dest.id === lot.originLocationId;
      const who = await this.allow(actor, back ? 'put_back' : 'workstation', summary.workstation);
      const destLot = await this.stock.moveWithin(tx, lot.id, dest.id, quantity, who, guest);
      return this.stock.view(tx, destLot);
    });
  }

  /** Puts stock back where it came from (its origin, kept since it left there). */
  async putBackLot(lotId: string, guest: string | null, actor: Actor | null): Promise<LotView> {
    const lot = await this.lotRow(lotId);
    const origin = lot.originLocationId;
    if (!origin) throw invalid('open.noOrigin');
    return this.moveLot(lot.id, origin, null, guest, actor);
  }

  /**
   * Clear the bench: units go home, stock goes back where it came from. What nobody knows a
   * place for stays, and is listed (boxes on the bench too).
   */
  async clear(ref: string, guest: string | null, actor: Actor | null): Promise<ClearResult> {
    return this.db.transaction(async (tx) => {
      const place = await this.locations.resolve(ref, tx);
      const summary = await this.locations.summarize(tx, place);
      if (!summary.workstation) throw invalid('open.onlyWorkstations');
      const who = await this.allow(actor, 'workstation', true);
      const result: ClearResult = { returned: [], left: [] };
      const unitRows = await this.units.directlyAt(place.id, tx);
      const briefs = await this.units.briefs(unitRows, tx);
      for (const [i, unit] of unitRows.entries()) {
        const name = briefs[i]!.name;
        if (!unit.homeLocationId || unit.homeLocationId === place.id) {
          result.left.push({ kind: 'unit', name });
          continue;
        }
        await this.units.moveWithin(tx, unit, unit.homeLocationId, who, guest);
        result.returned.push({ kind: 'unit', name, to: briefs[i]!.home! });
      }
      const lots = await many(
        tx
          .select({ lot: stockLots, name: parts.name })
          .from(stockLots)
          .innerJoin(parts, eq(parts.id, stockLots.partId))
          .where(eq(stockLots.locationId, place.id)),
      );
      for (const { lot, name } of lots) {
        const origin = lot.originLocationId;
        if (!origin || origin === place.id) {
          result.left.push({ kind: 'lot', name });
          continue;
        }
        await this.stock.moveWithin(tx, lot.id, origin, null, who, guest);
        result.returned.push({
          kind: 'lot',
          name,
          to: await this.locations.summarize(tx, await this.locations.resolve(origin, tx)),
        });
      }
      for (const box of await many(
        tx.select({ name: locations.name }).from(locations).where(eq(locations.parentId, place.id)),
      ))
        result.left.push({ kind: 'place', name: box.name });
      return result;
    });
  }

  /** The actor to record (null without an account), or an error when the move isn't allowed. */
  private async allow(
    actor: Actor | null,
    wanted: AnonymousActions,
    toWorkstation: boolean,
  ): Promise<Actor | null> {
    if (actor) return requireScope(actor, 'inventory');
    const setting = (await this.settings.get()).anonymousActions;
    if (wanted === 'workstation' && !toWorkstation) throw fail('unauthorized', 'open.logInToMove');
    if (!anonymousAllows(setting, wanted)) throw fail('unauthorized', 'open.logIn');
    return null;
  }

  private async lotRow(lotId: string, ex: Executor = this.db) {
    const lot = await one(ex.select().from(stockLots).where(eq(stockLots.id, lotId)));
    if (!lot) throw invalid('stock.noLot', { id: lotId });
    return lot;
  }
}
