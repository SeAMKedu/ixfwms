import {
  CreatePartInput,
  formatAmount,
  toColourValue,
  type AttributeFilter,
  isValidCode,
  normalizeCode,
  normalizeIdentifier,
  type IdentifierInput,
  type PartDetail,
  type PartSummary,
  type SimilarPart,
  type PartSearchInput,
  type PartStatus,
  type UpdatePartInput,
} from '@ixfwms/domain';
import { and, asc, desc, eq, exists, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, Executor } from '../db/client.js';
import {
  attachments,
  categories,
  locations,
  partIdentifiers,
  parts,
  partTags,
  stockLots,
  stockMovements,
  tags,
  units,
} from '../db/schema.js';
import { AppError, notFound } from '../lib/errors.js';
import { newId, nowIso } from '../lib/ids.js';
import type { CategoryService } from './categories.js';
import { allocateCode, retireCode } from './codes.js';
import { audit, requireScope, type Actor } from './context.js';
import type { FileService } from './files.js';
import type { LocationService } from './locations.js';
import type { StockService } from './stock.js';
import type { UnitService } from './units.js';

export type PartRow = typeof parts.$inferSelect;

/** Finds parts by id or code. Shared by services that only need lookups. */
export class PartResolver {
  constructor(private readonly db: Db) {}

  async resolve(ref: string, ex: Executor = this.db): Promise<PartRow> {
    const code = normalizeCode(ref);
    const row = isValidCode(code)
      ? await ex.select().from(parts).where(eq(parts.code, code)).get()
      : undefined;
    const found = row ?? (await ex.select().from(parts).where(eq(parts.id, ref)).get());
    if (!found) throw notFound('Part', ref);
    return found;
  }
}

export type BatchResult<T> = { ok: true; value: T } | { ok: false; error: string; index: number };

export class PartService {
  constructor(
    private readonly db: Db,
    private readonly resolver: PartResolver,
    private readonly locations: LocationService,
    private readonly stock: StockService,
    private readonly files: FileService,
    private readonly units: UnitService,
    private readonly categories: CategoryService,
  ) {}

  resolve(ref: string, ex: Executor = this.db): Promise<PartRow> {
    return this.resolver.resolve(ref, ex);
  }

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
        unitMassG: input.unitMassG ?? null,
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
        const a = input.stock.amount;
        await this.stock.addWithin(
          tx,
          id,
          input.stock.location ?? null,
          {
            mode: a.mode,
            quantity: a.mode === 'level' ? null : (a.quantity ?? null),
            unit: a.mode === 'measure' ? (a.unit ?? null) : null,
            level: a.mode === 'level' ? (a.level ?? null) : null,
            tareG: a.tareG ?? null,
          },
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
      } catch (err) {
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
        ? ((await tx.select().from(categories).where(eq(categories.id, categoryId)).get())?.path ??
          null)
        : null;
      patch.attributes = {
        ...part.attributes,
        ...(await this.normalizeAttributes(tx, category, input.attributes)),
      };
    }
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
        await tx.select().from(tags).where(inArray(tags.name, input.removeTags)).all()
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
      if (source.id === target.id)
        throw new AppError('invalid', 'A part cannot be merged into itself');

      const sourceUnits = await tx
        .select({ id: units.id })
        .from(units)
        .where(eq(units.partId, source.id))
        .all();
      if (sourceUnits.length) {
        if (target.tracking !== 'individual')
          await this.checkTrackingSwitch(tx, target, 'individual');
        await tx.update(units).set({ partId: target.id }).where(eq(units.partId, source.id));
        await tx.update(parts).set({ tracking: 'individual' }).where(eq(parts.id, target.id));
      }
      await tx.update(stockLots).set({ partId: target.id }).where(eq(stockLots.partId, source.id));
      for (const lot of await tx
        .select()
        .from(stockLots)
        .where(eq(stockLots.partId, target.id))
        .all()) {
        await this.stock.consolidate(tx, lot.id);
      }
      const idents = await tx
        .select()
        .from(partIdentifiers)
        .where(eq(partIdentifiers.partId, source.id))
        .all();
      await this.addIdentifiers(
        tx,
        target.id,
        idents.map((i) => ({ kind: i.kind, value: i.value, source: i.source })),
      );
      const tagNames = await tx
        .select({ name: tags.name })
        .from(partTags)
        .innerJoin(tags, eq(tags.id, partTags.tagId))
        .where(eq(partTags.partId, source.id))
        .all();
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
        'minStock',
        'source',
      ] as const) {
        if (target[key] == null && source[key] != null) Object.assign(fill, { [key]: source[key] });
      }
      if (source.notes)
        fill.notes = target.notes ? `${target.notes}\n${source.notes}` : source.notes;
      fill.attributes = { ...source.attributes, ...target.attributes };
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

  async get(ref: string): Promise<PartDetail> {
    const part = await this.resolve(ref);
    const [summary] = await this.summaries([part]);
    const history = await this.db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.partId, part.id))
      .orderBy(desc(stockMovements.at))
      .limit(20)
      .all();
    return {
      ...summary!,
      description: part.description,
      unitMassG: part.unitMassG,
      minStock: part.minStock,
      attributes: part.attributes,
      notes: part.notes,
      source: part.source,
      createdAt: part.createdAt,
      updatedAt: part.updatedAt,
      lots: await this.stock.lotsOfPart(part.id),
      attachments: await this.files.attachmentsOf('part', part.id),
      fields: summary!.category ? (await this.categories.fields(summary!.category)).effective : [],
      history: history.map((m) => ({
        at: m.at,
        reason: m.reason,
        delta: m.delta,
        fromLocationId: m.fromLocationId,
        toLocationId: m.toLocationId,
        note: m.note,
      })),
    };
  }

  async search(input: PartSearchInput): Promise<{ items: PartSummary[]; total: number }> {
    const where: SQL[] = [];
    if (input.q) {
      const q = `%${input.q.toLowerCase()}%`;
      const norm = normalizeIdentifier(input.q);
      const code = normalizeCode(input.q);
      const conditions: SQL[] = [
        like(sql`lower(${parts.name})`, q),
        like(sql`lower(coalesce(${parts.description}, ''))`, q),
        like(sql`lower(coalesce(${parts.manufacturer}, ''))`, q),
        like(sql`lower(${parts.aliases})`, q),
        eq(parts.code, code),
        // A unit's own name, serial number or code finds its item.
        exists(
          this.db
            .select({ one: sql`1` })
            .from(units)
            .where(
              and(
                eq(units.partId, parts.id),
                or(
                  like(sql`lower(coalesce(${units.name}, ''))`, q),
                  like(sql`lower(coalesce(${units.serialNo}, ''))`, q),
                  eq(units.code, code),
                ),
              ),
            ),
        ),
      ];
      if (norm.length >= 2) {
        conditions.push(
          exists(
            this.db
              .select({ one: sql`1` })
              .from(partIdentifiers)
              .where(
                and(
                  eq(partIdentifiers.partId, parts.id),
                  like(partIdentifiers.valueNormalised, `%${norm}%`),
                ),
              ),
          ),
        );
      }
      where.push(or(...conditions)!);
    }
    if (input.status) where.push(eq(parts.status, input.status));
    if (input.kind) where.push(eq(parts.kind, input.kind));
    if (input.category) {
      const cat = input.category.replace(/\s*\/\s*/g, '/').toLowerCase();
      where.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(categories)
            .where(
              and(
                eq(categories.id, parts.categoryId),
                or(
                  eq(sql`lower(${categories.path})`, cat),
                  like(sql`lower(${categories.path})`, `${cat}/%`),
                ),
              ),
            ),
        ),
      );
    }
    if (input.tag) {
      where.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(partTags)
            .innerJoin(tags, eq(tags.id, partTags.tagId))
            .where(
              and(
                eq(partTags.partId, parts.id),
                eq(sql`lower(${tags.name})`, input.tag.toLowerCase()),
              ),
            ),
        ),
      );
    }
    if (input.location) {
      const loc = await this.locations.resolve(input.location);
      where.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(stockLots)
            .innerJoin(locations, eq(locations.id, stockLots.locationId))
            .where(and(eq(stockLots.partId, parts.id), like(locations.path, `${loc.path}%`))),
        ),
      );
    }
    const levels = await this.stock.levels();
    const keysWhere = (ok: (state: string) => boolean) => {
      const keys = levels.filter((l) => ok(l.state)).map((l) => l.key);
      return keys.length ? keys : ['\u0000'];
    };
    if (input.lowStock) {
      const low = keysWhere((s) => s !== 'ok');
      where.push(sql`((${parts.minStock} is not null and coalesce((select sum(${stockLots.quantity}) from ${stockLots} where ${stockLots.partId} = ${parts.id} and ${stockLots.mode} = 'count'), 0) < ${parts.minStock})
        or exists (select 1 from ${stockLots} where ${stockLots.partId} = ${parts.id} and ${inArray(stockLots.level, low)}))`);
    }
    for (const filter of input.attributes ?? []) where.push(attributeCondition(filter));
    if (input.inStock !== undefined) {
      const inStock = exists(
        this.db
          .select({ one: sql`1` })
          .from(stockLots)
          .where(
            and(
              eq(stockLots.partId, parts.id),
              or(
                sql`${stockLots.quantity} > 0`,
                inArray(
                  stockLots.level,
                  keysWhere((s) => s !== 'empty'),
                ),
              ),
            ),
          ),
      );
      where.push(input.inStock ? inStock : sql`not ${inStock}`);
    }

    const condition = where.length ? and(...where) : undefined;
    const rows = await this.db
      .select()
      .from(parts)
      .where(condition)
      .orderBy(asc(sql`lower(${parts.name})`))
      .limit(input.limit)
      .offset(input.offset)
      .all();
    const total = await this.db.$count(parts, condition);
    return { items: await this.summaries(rows), total };
  }

  /**
   * Possible duplicates for a new entry: exact identifier matches first, then parts sharing
   * most words of the name. Used before creating drafts so the Inbox doesn't fill with copies.
   */
  async findSimilar(name: string | null, identifiers: string[]): Promise<SimilarPart[]> {
    const scored = new Map<string, { score: number; reason: string }>();
    const norms = identifiers.map(normalizeIdentifier).filter((n) => n.length >= 3);
    if (norms.length) {
      const hits = await this.db
        .select({ partId: partIdentifiers.partId, value: partIdentifiers.value })
        .from(partIdentifiers)
        .where(inArray(partIdentifiers.valueNormalised, norms))
        .all();
      for (const h of hits)
        scored.set(h.partId, { score: 1, reason: `same identifier ${h.value}` });
    }
    const tokens = [
      ...new Set(
        (name ?? '')
          .toLowerCase()
          .split(/[^\p{L}\p{N}.,×/]+/u)
          .filter((t) => t.length >= 2),
      ),
    ].slice(0, 8);
    if (tokens.length) {
      const candidates = await this.db
        .select({ id: parts.id, name: parts.name, aliases: parts.aliases })
        .from(parts)
        .where(
          or(
            ...tokens.flatMap((t) => [
              like(sql`lower(${parts.name})`, `%${t}%`),
              like(sql`lower(${parts.aliases})`, `%${t}%`),
            ]),
          ),
        )
        .limit(300)
        .all();
      for (const c of candidates) {
        const lower = [c.name, ...c.aliases].join(' ').toLowerCase();
        const matched = tokens.filter((t) => lower.includes(t)).length;
        const score = Math.round((matched / tokens.length) * 100) / 100;
        if (score >= 0.5 && score > (scored.get(c.id)?.score ?? 0)) {
          scored.set(c.id, { score, reason: `${matched} of ${tokens.length} words match` });
        }
      }
    }
    const top = [...scored.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 10);
    if (!top.length) return [];
    const rows = await this.db
      .select()
      .from(parts)
      .where(
        inArray(
          parts.id,
          top.map(([id]) => id),
        ),
      )
      .all();
    const summaries = new Map((await this.summaries(rows)).map((s) => [s.id, s]));
    return top.map(([id, s]) => ({ ...summaries.get(id)!, ...s }));
  }

  async summaries(rows: PartRow[], ex: Executor = this.db): Promise<PartSummary[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const catIds = [
      ...new Set(rows.map((r) => r.categoryId).filter((c): c is string => c != null)),
    ];
    const cats = catIds.length
      ? await ex.select().from(categories).where(inArray(categories.id, catIds)).all()
      : [];
    const catPath = new Map(cats.map((c) => [c.id, c.path]));
    const idents = await ex
      .select()
      .from(partIdentifiers)
      .where(inArray(partIdentifiers.partId, ids))
      .all();
    const tagRows = await ex
      .select({ partId: partTags.partId, name: tags.name })
      .from(partTags)
      .innerJoin(tags, eq(tags.id, partTags.tagId))
      .where(inArray(partTags.partId, ids))
      .all();
    const lots = await ex
      .select({ lot: stockLots, loc: locations })
      .from(stockLots)
      .innerJoin(locations, eq(locations.id, stockLots.locationId))
      .where(inArray(stockLots.partId, ids))
      .all();
    const places = new Map(
      (
        await this.locations.summaries(ex, [
          ...new Map(lots.map((l) => [l.loc.id, l.loc])).values(),
        ])
      ).map((p) => [p.id, p]),
    );
    const unitsByPart = await this.units.briefsForParts(
      rows.filter((r) => r.tracking === 'individual').map((r) => r.id),
      ex,
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      manufacturer: r.manufacturer,
      status: r.status,
      kind: r.kind,
      tracking: r.tracking,
      aliases: r.aliases,
      units: unitsByPart.get(r.id) ?? [],
      category: r.categoryId ? (catPath.get(r.categoryId) ?? null) : null,
      identifiers: idents
        .filter((i) => i.partId === r.id)
        .map((i) => ({ kind: i.kind, value: i.value })),
      tags: tagRows.filter((t) => t.partId === r.id).map((t) => t.name),
      stock: lots
        .filter((l) => l.lot.partId === r.id)
        .map((l) => ({
          display: formatAmount(l.lot),
          location: l.loc.name,
          locationCode: l.loc.code,
          place: places.get(l.loc.id)!,
        })),
    }));
  }

  /** Individual items have units, bulk ones stock lots; switching needs the other kind to be gone. */
  private async checkTrackingSwitch(
    ex: Executor,
    part: PartRow,
    to: PartRow['tracking'],
  ): Promise<void> {
    if (to === 'individual') {
      const lot = await ex
        .select({ id: stockLots.id })
        .from(stockLots)
        .where(eq(stockLots.partId, part.id))
        .limit(1)
        .get();
      if (lot)
        throw new AppError(
          'invalid',
          `${part.name} has stock amounts; move or remove them before tracking it one by one`,
        );
    } else {
      const unit = await ex
        .select({ id: units.id })
        .from(units)
        .where(eq(units.partId, part.id))
        .limit(1)
        .get();
      if (unit)
        throw new AppError('invalid', `${part.name} has units; it can't be tracked as amounts`);
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

  async listTags(): Promise<{ name: string; parts: number }[]> {
    const rows = await this.db
      .select({ name: tags.name, parts: sql<number>`count(${partTags.partId})` })
      .from(tags)
      .leftJoin(partTags, eq(partTags.tagId, tags.id))
      .groupBy(tags.id)
      .orderBy(asc(tags.name))
      .all();
    return rows.map((r) => ({ name: r.name, parts: Number(r.parts) }));
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
      let tag = await ex
        .select()
        .from(tags)
        .where(eq(sql`lower(${tags.name})`, name.toLowerCase()))
        .get();
      if (!tag) {
        tag = { id: newId(), name, color: null };
        await ex.insert(tags).values(tag);
      }
      await ex.insert(partTags).values({ partId, tagId: tag.id }).onConflictDoNothing();
    }
  }
}

/** SQL for one category-field filter on parts.attributes (keys are validated, so the JSON path is safe). */
function attributeCondition(filter: AttributeFilter): SQL {
  const value = sql`json_extract(${parts.attributes}, ${`$.${filter.key}`})`;
  // Colour values are { name, hex }: text filters compare the name.
  const text = sql`lower(cast(coalesce(json_extract(${parts.attributes}, ${`$.${filter.key}.name`}), ${value}) as text))`;
  switch (filter.op) {
    case 'gte':
      return sql`cast(${value} as real) >= ${Number(filter.value)}`;
    case 'lte':
      return sql`cast(${value} as real) <= ${Number(filter.value)}`;
    case 'contains':
      return like(text, `%${String(filter.value).toLowerCase()}%`);
    case 'eq':
      return typeof filter.value === 'number'
        ? sql`cast(${value} as real) = ${filter.value}`
        : eq(text, String(filter.value).toLowerCase());
  }
}

/** Aliases without blanks or repeats (case-insensitive), in the order given. */
function cleanAliases(aliases: string[]): string[] {
  const seen = new Set<string>();
  return aliases
    .map((a) => a.trim())
    .filter((a) => a && !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()));
}
