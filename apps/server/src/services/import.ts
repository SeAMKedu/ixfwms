import {
  ImportMapping,
  isValidCode,
  normalizeCode,
  normalizeIdentifier,
  type ImportOptions,
  type ImportResult,
  type ImportRow,
  type StockAmount,
} from '@ixfwms/domain';
import { asc, eq, inArray } from 'drizzle-orm';
import { many, type Db } from '../db/client.js';
import { importMappings, locations, partIdentifiers, parts } from '../db/schema.js';
import { AppError, invalid } from '../lib/errors.js';
import { nowIso } from '../lib/ids.js';
import { audit, requireScope, type Actor } from './context.js';
import type { LocationRow, LocationService } from './locations.js';
import type { PartService } from './parts.js';
import type { StockService } from './stock.js';

const MAX_ROWS = 2000;

interface Plan {
  row: number;
  input: ImportRow;
  action: ImportResult['action'];
  message: string | null;
  existing: { id: string; code: string; name: string } | null;
  location: LocationRow | null;
  amount: StockAmount | null;
}

/**
 * Spreadsheet import: rows become draft parts (or stock for parts we already have, matched by
 * order number or MPN). A dry run shows what would happen without changing anything.
 */
export class ImportService {
  constructor(
    private readonly db: Db,
    private readonly locations: LocationService,
    private readonly parts: PartService,
    private readonly stock: StockService,
  ) {}

  async importParts(
    rows: ImportRow[],
    options: ImportOptions,
    actor: Actor | null,
    dryRun: boolean,
  ): Promise<ImportResult[]> {
    const who = requireScope(actor, 'inventory');
    if (rows.length > MAX_ROWS) throw invalid('import.tooManyRows', { max: MAX_ROWS });
    const plans = await this.plan(rows, options);
    if (dryRun) return plans.map(toResult);

    const results: ImportResult[] = [];
    for (const plan of plans) {
      if (plan.action === 'error' || plan.action === 'skip') {
        results.push(toResult(plan));
        continue;
      }
      try {
        if (plan.action === 'add_stock' && plan.existing && plan.amount) {
          await this.db.transaction((tx) =>
            this.stock.addWithin(
              tx,
              plan.existing!.id,
              plan.location?.id ?? null,
              plan.amount!,
              who,
              'import',
            ),
          );
          results.push(toResult(plan));
        } else {
          const r = plan.input;
          const created = await this.parts.create(
            {
              name: r.name,
              kind: 'part',
              tracking: 'bulk',
              aliases: [],
              manufacturer: r.manufacturer ?? null,
              category: r.category ?? null,
              description: r.description ?? null,
              notes: r.notes ?? null,
              unitMassG: r.unitMassG ?? null,
              source: options.source ?? 'import',
              tags: r.tags,
              attributes: {},
              status: 'draft',
              identifiers: [
                ...(r.orderNo ? [{ kind: 'order_no' as const, value: r.orderNo }] : []),
                ...(r.mpn ? [{ kind: 'mpn' as const, value: r.mpn }] : []),
              ],
              stock: plan.amount
                ? {
                    location: plan.location?.id ?? null,
                    amount: {
                      mode: plan.amount.mode,
                      quantity: plan.amount.quantity,
                      unit: plan.amount.unit,
                      level: plan.amount.level,
                    },
                  }
                : null,
            },
            who,
          );
          results.push({ ...toResult(plan), part: { code: created.code, name: created.name } });
        }
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        results.push({ ...toResult(plan), action: 'error', message: err.message });
      }
    }
    return results;
  }

  private async plan(rows: ImportRow[], options: ImportOptions): Promise<Plan[]> {
    const all = await many(this.db.select().from(locations));
    const summaries = await this.locations.summaries(this.db, all);
    const byAddress = new Map<string, LocationRow | null>();
    for (const [i, s] of summaries.entries()) {
      if (!s.address) continue;
      const key = s.address.toLowerCase();
      // Two places with the same address: neither is meant.
      byAddress.set(key, byAddress.has(key) ? null : all[i]!);
    }
    const defaultLocation = options.defaultLocation
      ? await this.locations.resolve(options.defaultLocation)
      : null;
    const byIdent = options.matchExisting
      ? await this.existingByIdentifier(rows)
      : new Map<string, { id: string; code: string; name: string }>();

    return rows.map((input, i) => {
      const plan: Plan = {
        row: i + 1,
        input,
        action: 'create',
        message: null,
        existing: null,
        location: defaultLocation,
        amount: amountOf(input),
      };
      if (input.location) {
        const found =
          byAddress.get(input.location.trim().toLowerCase()) ?? findLocation(all, input.location);
        if (!found)
          return {
            ...plan,
            action: 'error',
            message: `No single place matches "${input.location}"`,
          };
        plan.location = found;
      }
      const keys = [input.orderNo, input.mpn]
        .filter((v): v is string => !!v)
        .map(normalizeIdentifier);
      const match = keys.map((k) => byIdent.get(k)).find(Boolean);
      if (match) {
        plan.existing = match;
        plan.action = plan.amount ? 'add_stock' : 'skip';
        plan.message = plan.amount
          ? null
          : 'Already in the inventory, and the row has no amount to add';
      }
      return plan;
    });
  }

  private async existingByIdentifier(rows: ImportRow[]) {
    const keys = [
      ...new Set(
        rows
          .flatMap((r) => [r.orderNo, r.mpn])
          .filter((v): v is string => !!v)
          .map(normalizeIdentifier),
      ),
    ];
    const map = new Map<string, { id: string; code: string; name: string }>();
    if (keys.length === 0) return map;
    const hits = await many(
      this.db
        .select({
          key: partIdentifiers.valueNormalised,
          id: parts.id,
          code: parts.code,
          name: parts.name,
        })
        .from(partIdentifiers)
        .innerJoin(parts, eq(parts.id, partIdentifiers.partId))
        .where(inArray(partIdentifiers.valueNormalised, keys)),
    );
    for (const h of hits)
      if (!map.has(h.key)) map.set(h.key, { id: h.id, code: h.code, name: h.name });
    return map;
  }

  async listMappings(): Promise<{ name: string; mapping: ImportMapping }[]> {
    const rows = await many(
      this.db.select().from(importMappings).orderBy(asc(importMappings.name)),
    );
    return rows.map((r) => ({ name: r.name, mapping: ImportMapping.parse(r.mapping) }));
  }

  async deleteMapping(name: string, actor: Actor | null): Promise<void> {
    const who = requireScope(actor, 'inventory');
    await this.db.delete(importMappings).where(eq(importMappings.name, name));
    await audit(this.db, who, 'delete', 'import-mapping', name);
  }

  async saveMapping(name: string, mapping: ImportMapping, actor: Actor | null): Promise<void> {
    const who = requireScope(actor, 'inventory');
    await this.db
      .insert(importMappings)
      .values({ name, mapping, updatedBy: who.userId })
      .onConflictDoUpdate({
        target: importMappings.name,
        set: { mapping, updatedBy: who.userId, updatedAt: nowIso() },
      });
  }
}

function amountOf(r: ImportRow): StockAmount | null {
  if (r.level) return { mode: 'level', quantity: null, unit: null, level: r.level };
  if (r.quantity == null) return null;
  if (!r.unit || r.unit === 'pcs')
    return { mode: 'count', quantity: r.quantity, unit: null, level: null };
  return { mode: 'measure', quantity: r.quantity, unit: r.unit, level: null };
}

/** A place by code, or by its path of names ("Lab › Cabinet A › Shelf 3", case-insensitive, last levels enough if unique). */
function findLocation(all: LocationRow[], text: string): LocationRow | null {
  const code = normalizeCode(text);
  if (isValidCode(code)) {
    const byCode = all.find((l) => l.code === code);
    if (byCode) return byCode;
  }
  const wanted = text
    .split(/\s*(?:›|>|\/)\s*/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (wanted.length === 0) return null;
  const byId = new Map(all.map((l) => [l.id, l]));
  const matches = all.filter((l) => {
    const names = l.path
      .split('/')
      .filter(Boolean)
      .map((id) => byId.get(id)?.name.toLowerCase() ?? '');
    return (
      names.length >= wanted.length &&
      wanted.every((w, i) => names[names.length - wanted.length + i] === w)
    );
  });
  return matches.length === 1 ? matches[0]! : null;
}

function toResult(plan: Plan): ImportResult {
  return {
    row: plan.row,
    action: plan.action,
    message: plan.message,
    part: plan.existing ? { code: plan.existing.code, name: plan.existing.name } : null,
    location: plan.location ? { code: plan.location.code, name: plan.location.name } : null,
  };
}
