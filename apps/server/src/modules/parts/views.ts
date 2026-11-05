import {
  fold,
  formatAmount,
  normalizeIdentifier,
  type PartDetail,
  type PartSummary,
  type SimilarPart,
  type PartSearchResult,
} from '@ixfwms/domain';
import { asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { many, type Db, type Executor } from '../../db/client.js';
import {
  categories,
  locations,
  partIdentifiers,
  parts,
  partTags,
  stockLots,
  stockMovements,
  tags,
} from '../../db/schema.js';
import type { BuildService } from '../builds/builds.js';
import type { CategoryService } from '../categories/categories.js';
import { detail, placeName } from '../../lib/context.js';
import type { FileService } from '../files/files.js';
import type { PlaceStore } from '../locations/store.js';
import { PartSearch, type SearchInput } from './part-search.js';
import { contains } from './search-text.js';
import type { StockService } from '../stock/stock.js';
import type { UnitViews } from '../units/views.js';

import type { PartResolver } from './store.js';
import { type PartRow } from './store.js';

/**
 * Reading parts: one part's page, search results, summaries and possible duplicates. Changes
 * are in PartService, which is a PartViews too.
 */
export class PartViews {
  constructor(
    protected readonly db: Db,
    protected readonly resolver: PartResolver,
    protected readonly locations: PlaceStore,
    protected readonly stock: StockService,
    protected readonly files: FileService,
    protected readonly units: UnitViews,
    protected readonly categories: CategoryService,
    protected readonly builds: BuildService,
  ) {
    this.searcher = new PartSearch(db, locations, stock, categories);
  }

  protected readonly searcher: PartSearch;

  resolve(ref: string, ex: Executor = this.db): Promise<PartRow> {
    return this.resolver.resolve(ref, ex);
  }

  async get(ref: string): Promise<PartDetail> {
    const part = await this.resolve(ref);
    const [summary] = await this.summaries([part]);
    const history = await many(
      this.db
        .select()
        .from(stockMovements)
        .where(eq(stockMovements.partId, part.id))
        .orderBy(desc(stockMovements.at))
        .limit(20),
    );
    return {
      ...summary!,
      description: part.description,
      unitMassG: part.unitMassG,
      minStock: part.minStock,
      attributes: part.attributes,
      notes: detail(part.notes),
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
        note: detail(m.note),
      })),
    };
  }

  /** A page of search results; see PartSearch for what a row is. */
  async search(input: SearchInput): Promise<PartSearchResult> {
    const { rows, total, within } = await this.searcher.rows(input);
    const ids = [...new Set(rows.flatMap((r) => ('partId' in r ? [r.partId] : [])))];
    // inArray of no ids is plain false.
    const found = await many(this.db.select().from(parts).where(inArray(parts.id, ids)));
    const byId = new Map(found.map((p) => [p.id, p]));
    const listed = ids.map((id) => byId.get(id)!);
    return {
      rows,
      items: await this.summaries(listed, this.db, within),
      total,
      builds: await this.builds.briefs(rows.flatMap((r) => ('buildId' in r ? [r.buildId] : []))),
    };
  }

  /**
   * Possible duplicates for a new entry: exact identifier matches first, then parts sharing
   * most words of the name. Used before creating drafts so the Inbox doesn't fill with copies.
   */
  async findSimilar(name: string | null, identifiers: string[]): Promise<SimilarPart[]> {
    const scored = new Map<string, { score: number; reason: string }>();
    const norms = identifiers.map(normalizeIdentifier).filter((n) => n.length >= 3);
    if (norms.length) {
      const hits = await many(
        this.db
          .select({ partId: partIdentifiers.partId, value: partIdentifiers.value })
          .from(partIdentifiers)
          .where(inArray(partIdentifiers.valueNormalised, norms)),
      );
      for (const h of hits)
        scored.set(h.partId, { score: 1, reason: `same identifier ${h.value}` });
    }
    const tokens = [
      ...new Set(
        fold(name ?? '')
          .split(/[^\p{L}\p{N}.,×/]+/u)
          .filter((t) => t.length >= 2),
      ),
    ].slice(0, 8);
    if (tokens.length) {
      const candidates = await many(
        this.db
          .select({ id: parts.id, name: parts.name, aliases: parts.aliases })
          .from(parts)
          .where(or(...tokens.map((t) => contains(parts.searchText, t))))
          .limit(300),
      );
      for (const c of candidates) {
        const text = fold([c.name, ...c.aliases].join(' '));
        const matched = tokens.filter((t) => text.includes(t)).length;
        const score = Math.round((matched / tokens.length) * 100) / 100;
        if (score >= 0.5 && score > (scored.get(c.id)?.score ?? 0)) {
          scored.set(c.id, { score, reason: `${matched} of ${tokens.length} words match` });
        }
      }
    }
    const top = [...scored.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 10);
    if (!top.length) return [];
    const rows = await many(
      this.db
        .select()
        .from(parts)
        .where(
          inArray(
            parts.id,
            top.map(([id]) => id),
          ),
        ),
    );
    const summaries = new Map((await this.summaries(rows)).map((s) => [s.id, s]));
    return top.map(([id, s]) => ({ ...summaries.get(id)!, ...s }));
  }

  /** `within`: list only the stock in this place (its path), for a search limited to it. */
  async summaries(rows: PartRow[], ex: Executor = this.db, within = ''): Promise<PartSummary[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const catIds = [
      ...new Set(rows.map((r) => r.categoryId).filter((c): c is string => c != null)),
    ];
    const cats = catIds.length
      ? await many(ex.select().from(categories).where(inArray(categories.id, catIds)))
      : [];
    const catPath = new Map(cats.map((c) => [c.id, c.path]));
    const idents = await many(
      ex.select().from(partIdentifiers).where(inArray(partIdentifiers.partId, ids)),
    );
    const tagRows = await many(
      ex
        .select({ partId: partTags.partId, name: tags.name })
        .from(partTags)
        .innerJoin(tags, eq(tags.id, partTags.tagId))
        .where(inArray(partTags.partId, ids)),
    );
    const lots = await many(
      ex
        .select({ lot: stockLots, loc: locations })
        .from(stockLots)
        .innerJoin(locations, eq(locations.id, stockLots.locationId))
        .where(inArray(stockLots.partId, ids)),
    );
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
      cut: r.cut,
      container: r.container,
      aliases: r.aliases,
      units: unitsByPart.get(r.id) ?? [],
      category: r.categoryId ? (catPath.get(r.categoryId) ?? null) : null,
      identifiers: idents
        .filter((i) => i.partId === r.id)
        .map((i) => ({ kind: i.kind, value: i.value })),
      tags: tagRows.filter((t) => t.partId === r.id).map((t) => t.name),
      stock: lots
        .filter((l) => l.lot.partId === r.id && l.loc.path.startsWith(within))
        .map((l) => ({
          display: formatAmount(l.lot),
          location: placeName(l.loc),
          locationCode: l.loc.code,
          place: places.get(l.loc.id)!,
        })),
    }));
  }

  async listTags(): Promise<{ name: string; parts: number }[]> {
    const rows = await many(
      this.db
        .select({ name: tags.name, parts: sql<number>`count(${partTags.partId})` })
        .from(tags)
        .leftJoin(partTags, eq(partTags.tagId, tags.id))
        .groupBy(tags.id)
        .orderBy(asc(tags.name)),
    );
    return rows.map((r) => ({ name: r.name, parts: Number(r.parts) }));
  }
}
