import {
  fold,
  normalizeCode,
  normalizeIdentifier,
  type AttributeFilter,
  type PartSearchInput,
  type PartSearchRow,
  type UnitStatus,
} from '@ixfwms/domain';
import { and, eq, exists, inArray, like, ne, or, sql, type SQL } from 'drizzle-orm';
import { many, type Db } from '../db/client.js';
import { jsonValue } from '../db/dialect.js';
import {
  categories,
  locations,
  partIdentifiers,
  parts,
  partTags,
  stockLots,
  tags,
  units,
} from '../db/schema.js';
import { withinCategory, type CategoryService } from './categories.js';
import type { LocationService } from './locations.js';
import { contains, unitSearchText } from './search-text.js';
import type { StockService } from './stock.js';

/** Unit states that count as having the thing (for in stock and low stock). */
const USABLE_UNIT: UnitStatus[] = ['ok', 'needs_attention'];

const NOTHING = sql`1 = 0`;

/** byUnit defaults to true: one result per unit. */
export type SearchInput = Omit<PartSearchInput, 'byUnit'> & { byUnit?: boolean };

type Candidate = Pick<typeof parts.$inferSelect, 'id' | 'name' | 'tracking' | 'attributes'>;
type LiveUnit = Pick<
  typeof units.$inferSelect,
  'id' | 'partId' | 'code' | 'name' | 'serialNo' | 'searchText'
>;

/**
 * Finds parts and lists them as things to open: a bulk item is one row, a tool or device one
 * row per unit that isn't retired. When the query names particular units (own name, serial
 * number, code) only those are listed, otherwise all of them. Pages count these rows, in
 * order of part name, then unit name.
 */
export class PartSearch {
  constructor(
    private readonly db: Db,
    private readonly locations: LocationService,
    private readonly stock: StockService,
    private readonly categories: CategoryService,
  ) {}

  async rows(input: SearchInput): Promise<{ rows: PartSearchRow[]; total: number }> {
    const condition = await this.condition(input);
    const textFilters = (input.attributes ?? []).filter(isTextFilter);
    const found = (
      await many(
        this.db
          .select({
            id: parts.id,
            name: parts.name,
            tracking: parts.tracking,
            attributes: parts.attributes,
          })
          .from(parts)
          .where(condition),
      )
    ).filter((p) => textFilters.every((f) => textMatches(p.attributes, f)));
    const live = await this.liveUnits(condition);

    const q = input.q ? fold(input.q) : '';
    const code = input.q ? normalizeCode(input.q) : '';
    const named = (u: LiveUnit) =>
      !!q && ((u.searchText ?? unitSearchText(u)).includes(q) || u.code === code);
    const all = found.sort(byName).flatMap((part): PartSearchRow[] => {
      const own =
        input.byUnit !== false && part.tracking === 'individual' ? (live.get(part.id) ?? []) : [];
      if (!own.length) return [{ partId: part.id, unitId: null }];
      const picked = own.some(named) ? own.filter(named) : own;
      const unitName = (u: LiveUnit) => fold(u.name ?? `${part.name} ${u.code}`);
      return picked
        .sort((a, b) => compare(unitName(a), unitName(b)) || compare(a.code, b.code))
        .map((u) => ({ partId: part.id, unitId: u.id }));
    });
    return { rows: all.slice(input.offset, input.offset + input.limit), total: all.length };
  }

  /** Units that aren't retired, of the individually tracked parts the search finds. */
  private async liveUnits(condition: SQL | undefined): Promise<Map<string, LiveUnit[]>> {
    const rows = await many(
      this.db
        .select({
          id: units.id,
          partId: units.partId,
          code: units.code,
          name: units.name,
          serialNo: units.serialNo,
          searchText: units.searchText,
        })
        .from(units)
        .where(
          and(
            ne(units.status, 'retired'),
            inArray(
              units.partId,
              this.db
                .select({ id: parts.id })
                .from(parts)
                .where(and(condition, eq(parts.tracking, 'individual'))),
            ),
          ),
        ),
    );
    const out = new Map<string, LiveUnit[]>();
    for (const u of rows) out.set(u.partId, [...(out.get(u.partId) ?? []), u]);
    return out;
  }

  /** The filters, as SQL on parts (text filters on category fields are checked afterwards). */
  private async condition(input: SearchInput): Promise<SQL | undefined> {
    const where: SQL[] = [];
    if (input.q) where.push(this.matchesText(input.q));
    if (input.status) where.push(eq(parts.status, input.status));
    if (input.kind) where.push(eq(parts.kind, input.kind));
    if (input.category) {
      const cat = await this.categories.lookup(input.category);
      where.push(
        cat
          ? exists(
              this.db
                .select({ one: sql`1` })
                .from(categories)
                .where(and(eq(categories.id, parts.categoryId), withinCategory(cat.path))),
            )
          : NOTHING,
      );
    }
    if (input.tag) {
      const wanted = fold(input.tag);
      const tag = (await many(this.db.select().from(tags))).find((t) => fold(t.name) === wanted);
      where.push(
        tag
          ? exists(
              this.db
                .select({ one: sql`1` })
                .from(partTags)
                .where(and(eq(partTags.partId, parts.id), eq(partTags.tagId, tag.id))),
            )
          : NOTHING,
      );
    }
    if (input.location) {
      const loc = await this.locations.resolve(input.location);
      where.push(
        or(
          exists(
            this.db
              .select({ one: sql`1` })
              .from(stockLots)
              .innerJoin(locations, eq(locations.id, stockLots.locationId))
              .where(and(eq(stockLots.partId, parts.id), like(locations.path, `${loc.path}%`))),
          ),
          exists(
            this.db
              .select({ one: sql`1` })
              .from(units)
              .innerJoin(locations, eq(locations.id, units.locationId))
              .where(and(eq(units.partId, parts.id), like(locations.path, `${loc.path}%`))),
          ),
        )!,
      );
    }
    // Units that can be used now: not retired, broken or in repair, and not lent out.
    const usableUnits = sql`(select count(*) from ${units} inner join ${locations} on ${locations.id} = ${units.locationId}
      where ${units.partId} = ${parts.id} and ${inArray(units.status, USABLE_UNIT)} and ${locations.kind} <> 'away')`;
    const levels = await this.stock.levels();
    const keysWhere = (ok: (state: string) => boolean) => {
      const keys = levels.filter((l) => ok(l.state)).map((l) => l.key);
      return keys.length ? keys : ['\u0000'];
    };
    // Lots nobody has counted (no quantity, or no level; see isUnknown).
    const uncounted = sql`(${stockLots.mode} = 'level' and ${stockLots.level} is null) or (${stockLots.mode} <> 'level' and ${stockLots.quantity} is null)`;
    const hasUncounted = sql`exists (select 1 from ${stockLots} where ${stockLots.partId} = ${parts.id} and (${uncounted}))`;
    if (input.uncounted) where.push(hasUncounted);
    if (input.lowStock) {
      const low = keysWhere((s) => s !== 'ok');
      // Below the minimum only when every lot is counted: uncounted stock may be plenty.
      where.push(sql`((${parts.minStock} is not null and not ${hasUncounted} and coalesce((select sum(${stockLots.quantity}) from ${stockLots} where ${stockLots.partId} = ${parts.id} and ${stockLots.mode} = 'count'), 0) + ${usableUnits} < ${parts.minStock})
        or exists (select 1 from ${stockLots} where ${stockLots.partId} = ${parts.id} and ${inArray(stockLots.level, low)}))`);
    }
    for (const filter of input.attributes ?? [])
      if (!isTextFilter(filter)) where.push(numberCondition(filter));
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
                uncounted,
                inArray(
                  stockLots.level,
                  keysWhere((s) => s !== 'empty'),
                ),
              ),
            ),
          ),
      );
      const available = or(inStock, sql`${usableUnits} > 0`)!;
      where.push(input.inStock ? available : sql`not ${available}`);
    }
    return where.length ? and(...where) : undefined;
  }

  /** Name, description, maker, aliases, code, identifiers, or a live unit's name, serial or code. */
  private matchesText(text: string): SQL {
    const norm = normalizeIdentifier(text);
    const code = normalizeCode(text);
    const conditions: SQL[] = [
      contains(parts.searchText, text),
      eq(parts.code, code),
      exists(
        this.db
          .select({ one: sql`1` })
          .from(units)
          .where(
            and(
              eq(units.partId, parts.id),
              ne(units.status, 'retired'),
              or(contains(units.searchText, text), eq(units.code, code)),
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
    return or(...conditions)!;
  }
}

/** Plain code-point order on folded text, the same everywhere. */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const byName = (a: Candidate, b: Candidate) =>
  compare(fold(a.name), fold(b.name)) || compare(a.id, b.id);

/** Text comparisons on category fields, done in JavaScript so case folds the same as elsewhere. */
const isTextFilter = (f: AttributeFilter) =>
  f.op === 'contains' || (f.op === 'eq' && typeof f.value !== 'number');

function textMatches(attributes: Record<string, unknown>, filter: AttributeFilter): boolean {
  const raw = attributes[filter.key];
  // Colour values are { name, hex }: text filters compare the name.
  const value: unknown = raw && typeof raw === 'object' && 'name' in raw ? raw.name : raw;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
    return false;
  const text = fold(String(value));
  const wanted = fold(String(filter.value));
  return filter.op === 'contains' ? text.includes(wanted) : text === wanted;
}

/** SQL for a number filter on parts.attributes (keys are validated, so the JSON path is safe). */
function numberCondition(filter: AttributeFilter): SQL {
  const value = jsonValue(parts.attributes, [filter.key]);
  switch (filter.op) {
    case 'gte':
      return sql`cast(${value} as real) >= ${Number(filter.value)}`;
    case 'lte':
      return sql`cast(${value} as real) <= ${Number(filter.value)}`;
    default:
      return sql`cast(${value} as real) = ${Number(filter.value)}`;
  }
}
