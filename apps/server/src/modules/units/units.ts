import {
  type AddUnitsInput,
  type UnitBrief,
  type UnitDetail,
  type UnitEventKind,
  type UnitLogInput,
  type UpdateUnitInput,
  AddUnitsInput as AddUnitsSchema,
} from '@ixfwms/domain';
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { many, one, type Executor } from '../../db/client.js';
import { parts, stockLots, unitEvents, units } from '../../db/schema.js';
import { invalid } from '../../lib/errors.js';
import { newId, nowIso } from '../../lib/ids.js';
import { allocateCode, claimCode } from '../../lib/codes.js';
import { audit, requireScope, type Actor } from '../../lib/context.js';
import type { LocationRow } from '../locations/store.js';
import { unitSearchText } from '../parts/search-text.js';
import { checkNotLent } from '../loans/rules.js';
import { openLoan } from '../loans/store.js';
import { ATTENTION, purchasePatch, UnitViews, type UnitRow } from './views.js';

/**
 * Individually tracked things: each has its own code, where it is now and where it belongs,
 * a log (moves, maintenance, firmware) and a status. Lending them is LoanService.
 */
export class UnitService extends UnitViews {
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
}
