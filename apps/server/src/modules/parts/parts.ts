import {
  CreatePartInput,
  fold,
  toColourValue,
  normalizeIdentifier,
  type IdentifierInput,
  type PartDetail,
  type PartStatus,
  type UpdatePartInput,
} from '@ixfwms/domain';
import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { many, one, type Executor } from '../../db/client.js';
import {
  attachments,
  categories,
  partIdentifiers,
  parts,
  partTags,
  stockLots,
  stockMovements,
  tags,
  units,
} from '../../db/schema.js';
import { AppError, invalid, ruleConflict } from '../../lib/errors.js';
import { newId, nowIso } from '../../lib/ids.js';
import { toAmount } from '../stock/amounts.js';
import { allocateCode, retireCode } from '../../lib/codes.js';
import { audit, requireScope, type Actor } from '../../lib/context.js';
import { cleanAliases, partSearchText } from './search-text.js';

import type { PartRow } from './store.js';
import { PartViews } from './views.js';

export type BatchResult<T> = { ok: true; value: T } | { ok: false; error: string; index: number };

export class PartService extends PartViews {
  async create(raw: z.input<typeof CreatePartInput>, actor: Actor | null): Promise<PartDetail> {
    const input = CreatePartInput.parse(raw);
    const who = requireScope(actor, input.status === 'draft' ? 'inventory' : 'write');
    const id = await this.db.transaction(async (tx) => {
      const id = newId();
      await tx.insert(parts).values({
        id,
        code: await allocateCode(tx),
        name: input.name,
        description: input.description ?? null,
        categoryId: input.category ? await this.categories.ensure(tx, input.category) : null,
        manufacturer: input.manufacturer ?? null,
        kind: input.kind,
        tracking: input.tracking,
        aliases: cleanAliases(input.aliases),
        searchText: partSearchText({
          name: input.name,
          description: input.description ?? null,
          manufacturer: input.manufacturer ?? null,
          aliases: cleanAliases(input.aliases),
        }),
        unitMassG: input.unitMassG ?? null,
        container: input.container ?? null,
        cut: input.cut ?? null,
        minStock: input.minStock ?? null,
        attributes: await this.normalizeAttributes(tx, input.category ?? null, input.attributes),
        notes: input.notes ?? null,
        source: input.source ?? null,
        status: input.status,
        createdBy: who.userId,
      });
      await this.addIdentifiers(tx, id, input.identifiers);
      await this.addTags(tx, id, input.tags);
      if (input.stock) {
        await this.stock.addWithin(
          tx,
          id,
          input.stock.location ?? null,
          toAmount(input.stock.amount, { name: input.name, container: input.container ?? null }),
          who,
          null,
        );
      }
      await audit(tx, who, 'create', 'part', id, {
        name: input.name,
        status: input.status,
        source: input.source,
      });
      return id;
    });
    return this.get(id);
  }

  /** Creates several parts; one failing entry doesn't stop the others. */
  async createMany(
    inputs: z.input<typeof CreatePartInput>[],
    actor: Actor | null,
  ): Promise<BatchResult<PartDetail>[]> {
    const results: BatchResult<PartDetail>[] = [];
    for (const [index, input] of inputs.entries()) {
      try {
        results.push({ ok: true, value: await this.create(input, actor) });
      } catch (thrown) {
        const err = ruleConflict(thrown) ?? thrown;
        if (!(err instanceof AppError)) throw err;
        results.push({ ok: false, error: err.message, index });
      }
    }
    return results;
  }

  async update(ref: string, input: UpdatePartInput, actor: Actor | null): Promise<PartDetail> {
    const who = requireScope(actor, 'inventory');
    const id = await this.db.transaction((tx) => this.updateWithin(tx, ref, input, who));
    return this.get(id);
  }

  /** The update itself, inside the caller's transaction (who already has the `inventory` scope). */
  async updateWithin(
    tx: Executor,
    ref: string,
    input: UpdatePartInput,
    who: Actor,
  ): Promise<string> {
    const part = await this.resolve(ref, tx);
    const patch: Partial<PartRow> = { updatedAt: nowIso() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description ?? null;
    if (input.manufacturer !== undefined) patch.manufacturer = input.manufacturer ?? null;
    if (input.unitMassG !== undefined) patch.unitMassG = input.unitMassG ?? null;
    if (input.container !== undefined) patch.container = input.container ?? null;
    if (input.cut !== undefined) patch.cut = input.cut ?? null;
    if (input.minStock !== undefined) patch.minStock = input.minStock ?? null;
    if (input.notes !== undefined) patch.notes = input.notes ?? null;
    if (input.source !== undefined) patch.source = input.source ?? null;
    if (input.kind !== undefined) patch.kind = input.kind;
    if (input.aliases !== undefined) patch.aliases = cleanAliases(input.aliases);
    if (input.tracking !== undefined && input.tracking !== part.tracking) {
      await this.checkTrackingSwitch(tx, part, input.tracking);
      patch.tracking = input.tracking;
    }
    if (input.category !== undefined) {
      patch.categoryId = input.category ? await this.categories.ensure(tx, input.category) : null;
    }
    if (input.attributes !== undefined) {
      const categoryId = patch.categoryId !== undefined ? patch.categoryId : part.categoryId;
      const category = categoryId
        ? ((await one(tx.select().from(categories).where(eq(categories.id, categoryId))))?.path ??
          null)
        : null;
      patch.attributes = {
        ...part.attributes,
        ...(await this.normalizeAttributes(tx, category, input.attributes)),
      };
    }
    patch.searchText = partSearchText({ ...part, ...patch });
    await tx.update(parts).set(patch).where(eq(parts.id, part.id));
    if (input.removeIdentifiers?.length) {
      await tx
        .delete(partIdentifiers)
        .where(
          and(
            eq(partIdentifiers.partId, part.id),
            inArray(partIdentifiers.value, input.removeIdentifiers),
          ),
        );
    }
    await this.addIdentifiers(tx, part.id, input.addIdentifiers ?? []);
    await this.addTags(tx, part.id, input.addTags ?? []);
    if (input.removeTags?.length) {
      const ids = (
        await many(tx.select().from(tags).where(inArray(tags.name, input.removeTags)))
      ).map((t) => t.id);
      if (ids.length)
        await tx
          .delete(partTags)
          .where(and(eq(partTags.partId, part.id), inArray(partTags.tagId, ids)));
    }
    await audit(tx, who, 'update', 'part', part.id, { ...input });
    return part.id;
  }

  /** Confirming drafts and archiving are deliberate human decisions, so they need the `write` scope. */
  async setStatus(ref: string, status: PartStatus, actor: Actor | null): Promise<PartDetail> {
    const who = requireScope(actor, 'write');
    const part = await this.resolve(ref);
    await this.db.transaction(async (tx) => {
      await tx.update(parts).set({ status, updatedAt: nowIso() }).where(eq(parts.id, part.id));
      await audit(tx, who, 'status', 'part', part.id, { from: part.status, to: status });
    });
    return this.get(part.id);
  }

  /**
   * Merges a duplicate into another part: stock, identifiers, tags, files and history move over,
   * empty fields are filled from the duplicate, and the duplicate is deleted.
   */
  async mergeInto(sourceRef: string, targetRef: string, actor: Actor | null): Promise<PartDetail> {
    const who = requireScope(actor, 'write');
    const targetId = await this.db.transaction(async (tx) => {
      const source = await this.resolve(sourceRef, tx);
      const target = await this.resolve(targetRef, tx);
      if (source.id === target.id) throw invalid('parts.mergeSelf');

      const sourceUnits = await many(
        tx.select({ id: units.id }).from(units).where(eq(units.partId, source.id)),
      );
      if (sourceUnits.length) {
        if (target.tracking !== 'individual')
          await this.checkTrackingSwitch(tx, target, 'individual');
        await tx.update(units).set({ partId: target.id }).where(eq(units.partId, source.id));
        await tx.update(parts).set({ tracking: 'individual' }).where(eq(parts.id, target.id));
      }
      await this.stock.moveLotsToPart(tx, source.id, target.id);
      const idents = await many(
        tx.select().from(partIdentifiers).where(eq(partIdentifiers.partId, source.id)),
      );
      await this.addIdentifiers(
        tx,
        target.id,
        idents.map((i) => ({ kind: i.kind, value: i.value, source: i.source })),
      );
      const tagNames = await many(
        tx
          .select({ name: tags.name })
          .from(partTags)
          .innerJoin(tags, eq(tags.id, partTags.tagId))
          .where(eq(partTags.partId, source.id)),
      );
      await this.addTags(
        tx,
        target.id,
        tagNames.map((t) => t.name),
      );
      await tx
        .update(attachments)
        .set({ ownerId: target.id })
        .where(and(eq(attachments.ownerType, 'part'), eq(attachments.ownerId, source.id)));
      await tx
        .update(stockMovements)
        .set({ partId: target.id })
        .where(eq(stockMovements.partId, source.id));

      const fill: Partial<PartRow> = { updatedAt: nowIso() };
      for (const key of [
        'description',
        'manufacturer',
        'categoryId',
        'unitMassG',
        'container',
        'minStock',
        'cut',
        'source',
      ] as const) {
        if (target[key] == null && source[key] != null) Object.assign(fill, { [key]: source[key] });
      }
      if (source.notes)
        fill.notes = target.notes ? `${target.notes}\n${source.notes}` : source.notes;
      fill.attributes = { ...source.attributes, ...target.attributes };
      fill.searchText = partSearchText({ ...target, ...fill });
      await tx.update(parts).set(fill).where(eq(parts.id, target.id));
      await tx.delete(parts).where(eq(parts.id, source.id));
      await retireCode(
        tx,
        source.code,
        `was part ${source.name}, merged into ${target.name}`,
        target.code,
      );
      await audit(tx, who, 'merge', 'part', target.id, {
        mergedPartId: source.id,
        mergedCode: source.code,
        mergedName: source.name,
      });
      return target.id;
    });
    return this.get(targetId);
  }

  /** Individual items have units, bulk ones stock lots; switching needs the other kind to be gone. */
  private async checkTrackingSwitch(
    ex: Executor,
    part: PartRow,
    to: PartRow['tracking'],
  ): Promise<void> {
    if (to === 'individual') {
      const lot = await one(
        ex
          .select({ id: stockLots.id })
          .from(stockLots)
          .where(eq(stockLots.partId, part.id))
          .limit(1),
      );
      if (lot) throw invalid('parts.hasAmounts', { name: part.name });
    } else {
      const unit = await one(
        ex.select({ id: units.id }).from(units).where(eq(units.partId, part.id)).limit(1),
      );
      if (unit) throw invalid('parts.hasUnits', { name: part.name });
    }
  }

  /** Colour fields are stored as { name, hex } whatever form they were given in ("blue", "BU", "#1e64c8"). */
  private async normalizeAttributes(
    ex: Executor,
    category: string | null,
    attributes: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!category) return attributes;
    const colourKeys = (await this.categories.fields(category, ex)).effective
      .filter((f) => f.type === 'colour')
      .map((f) => f.key);
    const out = { ...attributes };
    for (const key of colourKeys) if (key in out) out[key] = toColourValue(out[key]);
    return out;
  }

  private async addIdentifiers(
    ex: Executor,
    partId: string,
    identifiers: IdentifierInput[],
  ): Promise<void> {
    for (const ident of identifiers) {
      await ex
        .insert(partIdentifiers)
        .values({
          id: newId(),
          partId,
          kind: ident.kind,
          value: ident.value,
          valueNormalised: normalizeIdentifier(ident.value),
          source: ident.source ?? null,
        })
        .onConflictDoNothing();
    }
  }

  private async addTags(ex: Executor, partId: string, names: string[]): Promise<void> {
    for (const name of names) {
      let tag = (await many(ex.select().from(tags))).find((t) => fold(t.name) === fold(name));
      if (!tag) {
        tag = { id: newId(), name, color: null };
        await ex.insert(tags).values(tag);
      }
      await ex.insert(partTags).values({ partId, tagId: tag.id }).onConflictDoNothing();
    }
  }
}
