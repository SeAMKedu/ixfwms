import {
  anonymousAllows,
  type AnonymousActions,
  type ClearResult,
  type LotView,
  type MoveAmount,
  type UnitDetail,
} from '@ixfwms/domain';
import { eq } from 'drizzle-orm';
import { many, one, type Db, type Executor } from '../db/client.js';
import { locations, parts, stockLots, units } from '../db/schema.js';
import { nowIso } from '../lib/ids.js';
import { fail, invalid } from '../lib/errors.js';
import { requireScope, type Actor } from '../lib/context.js';
import type { LocationRow, PlaceStore } from '../modules/locations/store.js';
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
    private readonly locations: PlaceStore,
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
      await this.units.checkDestination(dest, tx);
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

  /**
   * A lost unit turned up: OK again, at `to` (logged in), or back home (without an account,
   * as far as the lab allows putting things back). Its log says it was found.
   */
  async foundUnit(
    ref: string,
    to: string | null,
    guest: string | null,
    actor: Actor | null,
  ): Promise<UnitDetail> {
    await this.db.transaction(async (tx) => {
      const unit = await this.units.resolve(ref, tx);
      if (unit.status !== 'lost') throw invalid('units.notLost');
      const destId = to
        ? (await this.locations.resolve(to, tx)).id
        : (unit.homeLocationId ?? unit.locationId);
      const dest = await this.locations.resolve(destId, tx);
      await this.units.checkDestination(dest, tx);
      const summary = await this.locations.summarize(tx, dest);
      const back = dest.id === unit.homeLocationId || dest.id === unit.locationId;
      const who = await this.allow(actor, back ? 'put_back' : 'workstation', summary.workstation);
      await tx
        .update(units)
        .set({ status: 'ok', lastSeenAt: nowIso(), updatedAt: nowIso() })
        .where(eq(units.id, unit.id));
      await this.units.event(tx, unit.id, 'found', { to: dest.id, who, guest });
      if (dest.id !== unit.locationId) await this.units.moveWithin(tx, unit, dest.id, who, guest);
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
    amount: number | null | MoveAmount,
    guest: string | null,
    actor: Actor | null,
  ): Promise<LotView> {
    const by = typeof amount === 'object' && amount ? amount : { quantity: amount };
    return this.db.transaction(async (tx) => {
      const lot = await this.lotRow(lotId, tx);
      const dest = await this.locations.resolve(to, tx);
      if (dest.kind === 'in_transit') throw invalid('stock.pickUpToCarry');
      const summary = await this.locations.summarize(tx, dest);
      const back = dest.id === lot.originLocationId;
      const who = await this.allow(actor, back ? 'put_back' : 'workstation', summary.workstation);
      const destLot = await this.stock.pieces.move(tx, lot.id, dest.id, by, who, guest);
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
      return this.sendBack(tx, place, who, guest);
    });
  }

  /**
   * Units directly at `place` go home, stock goes back where it came from. What belongs here or
   * inside, or nobody knows a place for, stays and is listed (boxes and other places too).
   */
  async sendBack(
    tx: Executor,
    place: LocationRow,
    who: Actor | null,
    guest: string | null,
  ): Promise<ClearResult> {
    const result: ClearResult = { returned: [], left: [] };
    const inside = (id: string) =>
      this.locations.resolve(id, tx).then((l) => l.path.startsWith(place.path));
    const unitRows = await this.units.directlyAt(place.id, tx);
    const briefs = await this.units.briefs(unitRows, tx);
    for (const [i, unit] of unitRows.entries()) {
      const name = briefs[i]!.name;
      if (!unit.homeLocationId || (await inside(unit.homeLocationId))) {
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
      if (!origin || (await inside(origin))) {
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
