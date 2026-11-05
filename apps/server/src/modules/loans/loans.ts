import {
  fold,
  type LendInput,
  type LoanView,
  type ReturnPlaceInput,
  type UnitDetail,
} from '@ixfwms/domain';
import { and, asc, eq, isNull, like } from 'drizzle-orm';
import { many, one, type Db, type Executor } from '../../db/client.js';
import { loans, locations, units, users } from '../../db/schema.js';
import { invalid } from '../../lib/errors.js';
import { newId, nowIso } from '../../lib/ids.js';
import { audit, requireScope, type Actor } from '../../lib/context.js';
import type { LocationService } from '../locations/locations.js';
import type { LocationRow } from '../locations/store.js';
import type { UnitService } from '../units/units.js';

import { loanViews, openLoan, placeLoans, type LoanRow } from './store.js';

/**
 * Lending out of the lab: a unit, or a whole container (a drone case with its controller,
 * charger and batteries) with everything in it. Lent things sit in the built-in place
 * "Out of the lab"; nothing goes into or comes out of a lent container until it's returned.
 */
export class LoanService {
  constructor(
    private readonly db: Db,
    private readonly locations: LocationService,
    private readonly units: UnitService,
  ) {}

  /** Lends a unit out of the lab: it moves to "Out of the lab" with the person responsible for it. */
  async lendUnit(ref: string, input: LendInput, actor: Actor | null): Promise<UnitDetail> {
    const who = requireScope(actor, 'inventory');
    await this.db.transaction(async (tx) => {
      const unit = await this.units.resolve(ref, tx);
      if (await openLoan(tx, unit.id)) throw invalid('units.alreadyLent');
      const responsible = await this.responsible(tx, input, who);
      const away = await this.locations.away(tx);
      await this.units.moveWithin(tx, unit, away.id, who, null, 'lent', input.description);
      await tx.insert(loans).values({
        id: newId(),
        unitId: unit.id,
        responsibleUserId: responsible.id,
        description: input.description,
        dueAt: input.dueAt ?? null,
        createdBy: who.userId,
      });
      await audit(tx, who, 'lend', 'unit', unit.id, { responsible: responsible.name });
    });
    return this.units.detail(ref, actor);
  }

  /** Back from a loan: to `to`, else its home place, else the Inbox. */
  async returnUnit(ref: string, to: string | null, actor: Actor | null): Promise<UnitDetail> {
    const who = requireScope(actor, 'inventory');
    await this.db.transaction(async (tx) => {
      const unit = await this.units.resolve(ref, tx);
      const loan = await openLoan(tx, unit.id);
      if (!loan) throw invalid('units.notLent');
      await this.close(tx, loan, who);
      const dest = to
        ? await this.locations.resolve(to, tx)
        : unit.homeLocationId
          ? await this.locations.resolve(unit.homeLocationId, tx)
          : await this.locations.inbox(tx);
      await this.units.checkDestination(dest, tx);
      await this.units.moveWithin(tx, unit, dest.id, who, null, 'returned');
    });
    return this.units.detail(ref, actor);
  }

  /**
   * Lends a container with everything in it. It moves to "Out of the lab", remembering where it
   * was; each unit inside gets a "lent" entry in its log.
   */
  async lendPlace(ref: string, input: LendInput, actor: Actor | null): Promise<LoanView> {
    const who = requireScope(actor, 'inventory');
    const id = await this.db.transaction(async (tx) => {
      const place = await this.locations.resolve(ref, tx);
      const summary = await this.locations.summarize(tx, place);
      if (place.kind !== 'normal' || !summary.movable)
        throw invalid('loans.containersOnly', { name: place.name });
      await this.locations.checkOpen(place, tx);
      const responsible = await this.responsible(tx, input, who);
      const inside = await this.unitsIn(tx, place);
      await this.locations.relink(tx, place, await this.locations.away(tx), who);
      const loanId = newId();
      await tx.insert(loans).values({
        id: loanId,
        locationId: place.id,
        fromLocationId: place.parentId,
        responsibleUserId: responsible.id,
        description: input.description,
        dueAt: input.dueAt ?? null,
        createdBy: who.userId,
      });
      for (const unit of inside)
        await this.units.event(tx, unit.id, 'lent', {
          text: input.description,
          value: place.name,
          who,
        });
      await audit(tx, who, 'lend', 'location', place.id, { responsible: responsible.name });
      return loanId;
    });
    return this.view(id);
  }

  /**
   * A lent container is back: to `to`, else where it was before, else the Inbox. Units inside
   * listed as `missing` didn't come back and are marked lost; the rest get a "returned" entry.
   */
  async returnPlace(ref: string, input: ReturnPlaceInput, actor: Actor | null): Promise<LoanView> {
    const who = requireScope(actor, 'inventory');
    const id = await this.db.transaction(async (tx) => {
      const place = await this.locations.resolve(ref, tx);
      const loan = await one(
        tx
          .select()
          .from(loans)
          .where(and(eq(loans.locationId, place.id), isNull(loans.returnedAt))),
      );
      if (!loan) throw invalid('units.notLent');
      const inside = await this.unitsIn(tx, place);
      const missing = new Set<string>();
      for (const code of input.missing ?? []) {
        const unit = await this.units.resolve(code, tx);
        if (!inside.some((u) => u.id === unit.id))
          throw invalid('loans.notInside', { unit: code, name: place.name });
        missing.add(unit.id);
      }
      await this.close(tx, loan, who);
      const dest = await this.returnTo(tx, input.to ?? null, loan);
      await this.locations.checkOpen(dest, tx);
      await this.locations.relink(tx, place, dest, who);
      for (const unit of inside) {
        if (!missing.has(unit.id)) {
          await this.units.event(tx, unit.id, 'returned', { value: place.name, who });
          await tx.update(units).set({ lastSeenAt: nowIso() }).where(eq(units.id, unit.id));
        } else if (unit.status !== 'lost') {
          await tx
            .update(units)
            .set({ status: 'lost', updatedAt: nowIso() })
            .where(eq(units.id, unit.id));
          await this.units.event(tx, unit.id, 'status', { value: 'lost', who });
        }
      }
      await audit(tx, who, 'return', 'location', place.id, { missing: missing.size });
      return loan.id;
    });
    return this.view(id);
  }

  /** Who has what out: names of the people responsible, so not for guests. */
  async list(open: boolean, actor: Actor | null): Promise<LoanView[]> {
    requireScope(actor, 'read');
    const rows = await many(
      this.db
        .select()
        .from(loans)
        .where(open ? isNull(loans.returnedAt) : undefined)
        .orderBy(asc(loans.dueAt), asc(loans.outAt))
        .limit(open ? 1000 : 200),
    );
    return loanViews(this.db, rows);
  }

  /** The open loan of this place, or of the container it's inside. */
  async ofPlace(place: LocationRow): Promise<LoanView | null> {
    return (await placeLoans(this.db, [place])).get(place.id) ?? null;
  }

  private async view(id: string): Promise<LoanView> {
    const [view] = await loanViews(
      this.db,
      await many(this.db.select().from(loans).where(eq(loans.id, id))),
    );
    return view!;
  }

  /** Someone with an account (by name), or whoever is lending it. */
  private async responsible(tx: Executor, input: LendInput, who: Actor) {
    const responsible = input.responsible
      ? (await many(tx.select().from(users))).find((u) => fold(u.name) === fold(input.responsible!))
      : { id: who.userId, name: who.name };
    if (!responsible) throw invalid('units.noResponsible', { name: input.responsible ?? '' });
    if ('disabledAt' in responsible && responsible.disabledAt)
      throw invalid('users.accountOff', { name: responsible.name });
    return responsible;
  }

  private async close(tx: Executor, loan: LoanRow, who: Actor): Promise<void> {
    await tx
      .update(loans)
      .set({ returnedAt: nowIso(), returnedBy: who.userId })
      .where(eq(loans.id, loan.id));
  }

  /** Where a returned container goes: as asked, else back where it was if that's still a place to put things. */
  private async returnTo(tx: Executor, to: string | null, loan: LoanRow): Promise<LocationRow> {
    if (to) return this.locations.resolve(to, tx);
    const from = loan.fromLocationId
      ? await one(tx.select().from(locations).where(eq(locations.id, loan.fromLocationId)))
      : undefined;
    const usable = from && from.kind === 'normal' && !from.archivedAt && !from.dismantledAt;
    return usable ? from : this.locations.inbox(tx);
  }

  private async unitsIn(tx: Executor, place: LocationRow) {
    return many(
      tx
        .select({ id: units.id, status: units.status })
        .from(units)
        .innerJoin(locations, eq(locations.id, units.locationId))
        .where(like(locations.path, `${place.path}%`)),
    );
  }
}
