import type { LoanView } from '@ixfwms/domain';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { many, one, type Executor } from '../../db/client.js';
import { loans, locations, parts, units, users } from '../../db/schema.js';
import { loanReason, personName } from '../../lib/context.js';
import type { LocationRow } from '../locations/store.js';

export type LoanRow = typeof loans.$inferSelect;

const today = () => new Date().toISOString().slice(0, 10);

export async function openLoan(ex: Executor, unitId: string): Promise<LoanRow | undefined> {
  return one(
    ex
      .select()
      .from(loans)
      .where(and(eq(loans.unitId, unitId), isNull(loans.returnedAt))),
  );
}

/** Open container loans covering these places (the place lent, or one it's inside), by place id. */
export async function placeLoans(
  ex: Executor,
  places: Pick<LocationRow, 'id' | 'path'>[],
): Promise<Map<string, LoanView>> {
  const out = new Map<string, LoanView>();
  if (!places.length) return out;
  const rows = await many(
    ex
      .select()
      .from(loans)
      .where(and(isNotNull(loans.locationId), isNull(loans.returnedAt))),
  );
  if (!rows.length) return out;
  const views = await loanViews(ex, rows);
  const byPlace = new Map(rows.map((r, i) => [r.locationId!, views[i]!]));
  for (const p of places) {
    const id = p.path.split('/').find((x) => byPlace.has(x));
    if (id) out.set(p.id, byPlace.get(id)!);
  }
  return out;
}

export async function loanViews(ex: Executor, rows: LoanRow[]): Promise<LoanView[]> {
  if (!rows.length) return [];
  const userIds = [
    ...new Set(
      rows.flatMap((r) => [r.responsibleUserId, r.returnedBy]).filter((x): x is string => !!x),
    ),
  ];
  const names = new Map(
    (await many(ex.select().from(users).where(inArray(users.id, userIds)))).map((u) => [
      u.id,
      u.name,
    ]),
  );
  const unitIds = [...new Set(rows.map((r) => r.unitId).filter((x): x is string => !!x))];
  const unitRows = unitIds.length
    ? await many(
        ex
          .select({ id: units.id, code: units.code, name: units.name, part: parts.name })
          .from(units)
          .innerJoin(parts, eq(parts.id, units.partId))
          .where(inArray(units.id, unitIds)),
      )
    : [];
  const unitById = new Map(unitRows.map((u) => [u.id, u]));
  const placeIds = [...new Set(rows.map((r) => r.locationId).filter((x): x is string => !!x))];
  const placeRows = placeIds.length
    ? await many(
        ex
          .select({ id: locations.id, code: locations.code, name: locations.name })
          .from(locations)
          .where(inArray(locations.id, placeIds)),
      )
    : [];
  const placeById = new Map(placeRows.map((p) => [p.id, p]));
  return rows.map((r) => {
    const u = r.unitId ? unitById.get(r.unitId) : undefined;
    const p = r.locationId ? placeById.get(r.locationId) : undefined;
    return {
      id: r.id,
      unit: r.unitId
        ? {
            code: u?.code ?? '?',
            name: u?.name ?? `${u?.part ?? '?'} ${u?.code ?? ''}`.trim(),
          }
        : null,
      place: p ? { code: p.code, name: p.name } : null,
      responsible: personName(names.get(r.responsibleUserId) ?? '?'),
      description: loanReason(r.description),
      outAt: r.outAt,
      dueAt: r.dueAt,
      overdue: !r.returnedAt && !!r.dueAt && r.dueAt < today(),
      returnedAt: r.returnedAt,
      returnedBy: r.returnedBy ? personName(names.get(r.returnedBy)) : null,
    };
  });
}
