import {
  formatAmount,
  isValidCode,
  normalizeCode,
  normalizeIdentifier,
  type CreatePartInput,
  type IdentifierInput,
  type PartSearchInput,
  type PartStatus,
  type UpdatePartInput,
} from '@ixfwms/domain';
import { and, asc, desc, eq, exists, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import type { Db, Executor } from '../db/client.js';
import {
  categories,
  locations,
  partIdentifiers,
  parts,
  partTags,
  stockLots,
  stockMovements,
  tags,
} from '../db/schema.js';
import { AppError, notFound } from '../lib/errors.js';
import { newId, nowIso } from '../lib/ids.js';
import { allocateCode } from './codes.js';
import { audit, requireScope, type Actor } from './context.js';
import type { AttachmentView, FileService } from './files.js';
import type { LocationService } from './locations.js';
import type { LotView, StockService } from './stock.js';

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

export interface PartSummary {
  id: string;
  code: string;
  name: string;
  manufacturer: string | null;
  status: PartStatus;
  category: string | null;
  identifiers: { kind: string; value: string }[];
  tags: string[];
  stock: { display: string; location: string; locationCode: string }[];
}

interface MovementView {
  at: string;
  reason: string;
  delta: number | null;
  fromLocationId: string | null;
  toLocationId: string | null;
  note: string | null;
}

export interface PartDetail extends PartSummary {
  description: string | null;
  unitMassG: number | null;
  minStock: number | null;
  attributes: Record<string, unknown>;
  notes: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  lots: LotView[];
  attachments: AttachmentView[];
  history: MovementView[];
}

export interface SimilarPart extends PartSummary {
  score: number;
  reason: string;
}

export type BatchResult<T> = { ok: true; value: T } | { ok: false; error: string; index: number };

export class PartService {
  constructor(
    private readonly db: Db,
    private readonly resolver: PartResolver,
    private readonly locations: LocationService,
    private readonly stock: StockService,
    private readonly files: FileService,
  ) {}

  resolve(ref: string, ex: Executor = this.db): Promise<PartRow> {
    return this.resolver.resolve(ref, ex);
  }

  async create(input: CreatePartInput, actor: Actor | null): Promise<PartDetail> {
    const who = requireScope(actor, input.status === 'draft' ? 'inventory' : 'write');
    const id = await this.db.transaction(async (tx) => {
      const id = newId();
      await tx.insert(parts).values({
        id,
        code: await allocateCode(tx),
        name: input.name,
        description: input.description ?? null,
        categoryId: input.category ? await this.ensureCategory(tx, input.category) : null,
        manufacturer: input.manufacturer ?? null,
        unitMassG: input.unitMassG ?? null,
        minStock: input.minStock ?? null,
        attributes: input.attributes,
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
    inputs: CreatePartInput[],
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
    const id = await this.db.transaction(async (tx) => {
      const part = await this.resolve(ref, tx);
      const patch: Partial<PartRow> = { updatedAt: nowIso() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.description !== undefined) patch.description = input.description ?? null;
      if (input.manufacturer !== undefined) patch.manufacturer = input.manufacturer ?? null;
      if (input.unitMassG !== undefined) patch.unitMassG = input.unitMassG ?? null;
      if (input.minStock !== undefined) patch.minStock = input.minStock ?? null;
      if (input.notes !== undefined) patch.notes = input.notes ?? null;
      if (input.source !== undefined) patch.source = input.source ?? null;
      if (input.attributes !== undefined)
        patch.attributes = { ...part.attributes, ...input.attributes };
      if (input.category !== undefined) {
        patch.categoryId = input.category ? await this.ensureCategory(tx, input.category) : null;
      }
      await tx.update(parts).set(patch).where(eq(parts.id, part.id));
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
    });
    return this.get(id);
  }

  /** Confirming drafts and archiving are deliberate human decisions, so they need the `write` scope. */
  async setStatus(ref: string, status: PartStatus, actor: Actor | null): Promise<PartDetail> {
    const who = requireScope(actor, 'write');
    const part = await this.resolve(ref);
    await this.db.update(parts).set({ status, updatedAt: nowIso() }).where(eq(parts.id, part.id));
    await audit(this.db, who, 'status', 'part', part.id, { from: part.status, to: status });
    return this.get(part.id);
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
      const conditions: SQL[] = [
        like(sql`lower(${parts.name})`, q),
        like(sql`lower(coalesce(${parts.description}, ''))`, q),
        like(sql`lower(coalesce(${parts.manufacturer}, ''))`, q),
        eq(parts.code, normalizeCode(input.q)),
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
    if (input.inStock !== undefined) {
      const inStock = exists(
        this.db
          .select({ one: sql`1` })
          .from(stockLots)
          .where(
            and(
              eq(stockLots.partId, parts.id),
              or(sql`${stockLots.quantity} > 0`, inArray(stockLots.level, ['plenty', 'low'])),
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
        .select({ id: parts.id, name: parts.name })
        .from(parts)
        .where(or(...tokens.map((t) => like(sql`lower(${parts.name})`, `%${t}%`))))
        .limit(300)
        .all();
      for (const c of candidates) {
        const lower = c.name.toLowerCase();
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
      .select({ lot: stockLots, locName: locations.name, locCode: locations.code })
      .from(stockLots)
      .innerJoin(locations, eq(locations.id, stockLots.locationId))
      .where(inArray(stockLots.partId, ids))
      .all();
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      manufacturer: r.manufacturer,
      status: r.status,
      category: r.categoryId ? (catPath.get(r.categoryId) ?? null) : null,
      identifiers: idents
        .filter((i) => i.partId === r.id)
        .map((i) => ({ kind: i.kind, value: i.value })),
      tags: tagRows.filter((t) => t.partId === r.id).map((t) => t.name),
      stock: lots
        .filter((l) => l.lot.partId === r.id)
        .map((l) => ({
          display: formatAmount(l.lot),
          location: l.locName,
          locationCode: l.locCode,
        })),
    }));
  }

  /** Returns the id of the category at `path` ("Pneumatics/Vacuum"), creating missing levels. */
  async ensureCategory(ex: Executor, path: string): Promise<string> {
    const names = path
      .split('/')
      .map((n) => n.trim())
      .filter(Boolean);
    let parentId: string | null = null;
    let current = '';
    for (const name of names) {
      current = current ? `${current}/${name}` : name;
      const existing = await ex
        .select()
        .from(categories)
        .where(eq(sql`lower(${categories.path})`, current.toLowerCase()))
        .get();
      if (existing) {
        parentId = existing.id;
        current = existing.path;
        continue;
      }
      const id = newId();
      await ex.insert(categories).values({ id, parentId, name, path: current });
      parentId = id;
    }
    if (!parentId) throw new AppError('invalid', 'Category path is empty');
    return parentId;
  }

  async listCategories(): Promise<{ path: string; parts: number }[]> {
    const rows = await this.db
      .select({ path: categories.path, parts: sql<number>`count(${parts.id})` })
      .from(categories)
      .leftJoin(parts, eq(parts.categoryId, categories.id))
      .groupBy(categories.id)
      .orderBy(asc(categories.path))
      .all();
    return rows.map((r) => ({ path: r.path, parts: Number(r.parts) }));
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
