import { ReportInput, type ReportView } from '@ixfwms/domain';
import { and, desc, eq, inArray, isNull, isNotNull } from 'drizzle-orm';
import { many, one, type Db } from '../db/client.js';
import { locations, parts, reports, units, users } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { newId, nowIso } from '../lib/ids.js';
import { audit, detail, personName, placeName, requireScope, type Actor } from '../lib/context.js';
import type { PlaceStore } from '../modules/locations/store.js';
import type { PartResolver } from './parts.js';
import type { UnitService } from './units.js';

type ReportRow = typeof reports.$inferSelect;

/**
 * "This is broken / missing parts / running low": anyone can report, with or without an account.
 * Reports stay in the Inbox until someone resolves them. A report on a unit marks it too.
 */
export class ReportService {
  constructor(
    private readonly db: Db,
    private readonly locations: PlaceStore,
    private readonly parts: PartResolver,
    private readonly units: UnitService,
  ) {}

  async create(input: ReportInput, actor: Actor | null): Promise<ReportView> {
    const r = ReportInput.parse(input);
    const id = await this.db.transaction(async (tx) => {
      const ownerId =
        r.owner === 'unit'
          ? (await this.units.resolve(r.ref, tx)).id
          : r.owner === 'part'
            ? (await this.parts.resolve(r.ref, tx)).id
            : (await this.locations.resolve(r.ref, tx)).id;
      const id = newId();
      await tx.insert(reports).values({
        id,
        ownerType: r.owner,
        ownerId,
        kind: r.kind,
        note: r.note ?? null,
        userId: actor?.userId ?? null,
        reporterName: actor ? null : (r.name ?? null),
      });
      if (r.owner === 'unit') {
        const unit = await this.units.resolve(ownerId, tx);
        await this.units.event(tx, unit.id, 'problem', {
          // The report kind goes in `value`, so the log can show it in the reader's language.
          value: r.kind,
          text: r.note ?? null,
          who: actor,
          guest: r.name ?? null,
        });
        const status = r.kind === 'broken' ? 'broken' : 'needs_attention';
        if (unit.status === 'ok' || (status === 'broken' && unit.status === 'needs_attention'))
          await tx
            .update(units)
            .set({ status, lastSeenAt: nowIso(), updatedAt: nowIso() })
            .where(eq(units.id, unit.id));
      }
      return id;
    });
    return (await this.views([await this.row(id)]))[0]!;
  }

  async list(open: boolean): Promise<ReportView[]> {
    const rows = await many(
      this.db
        .select()
        .from(reports)
        .where(open ? isNull(reports.resolvedAt) : isNotNull(reports.resolvedAt))
        .orderBy(desc(reports.createdAt))
        .limit(open ? 1000 : 200),
    );
    return this.views(rows);
  }

  /** Done with a report. When a unit has no open reports left, it's back to OK (logged as repaired). */
  async resolve(id: string, resolution: string | null, actor: Actor | null): Promise<ReportView> {
    const who = requireScope(actor, 'inventory');
    await this.db.transaction(async (tx) => {
      const report = await one(tx.select().from(reports).where(eq(reports.id, id)));
      if (!report) throw notFound('report', id);
      if (report.resolvedAt) return;
      await tx
        .update(reports)
        .set({ resolvedAt: nowIso(), resolvedBy: who.userId, resolution })
        .where(eq(reports.id, id));
      if (report.ownerType === 'unit') {
        const others = await many(
          tx
            .select({ id: reports.id })
            .from(reports)
            .where(
              and(
                eq(reports.ownerType, 'unit'),
                eq(reports.ownerId, report.ownerId),
                isNull(reports.resolvedAt),
              ),
            ),
        );
        const unit = await this.units.resolve(report.ownerId, tx);
        if (!others.length && ['needs_attention', 'broken'].includes(unit.status)) {
          await tx
            .update(units)
            .set({ status: 'ok', updatedAt: nowIso() })
            .where(eq(units.id, unit.id));
          await this.units.event(tx, unit.id, 'repaired', { text: resolution, who });
        }
      }
      await audit(tx, who, 'resolve', 'report', id, { resolution });
    });
    return (await this.views([await this.row(id)]))[0]!;
  }

  private async row(id: string): Promise<ReportRow> {
    const row = await one(this.db.select().from(reports).where(eq(reports.id, id)));
    if (!row) throw notFound('report', id);
    return row;
  }

  private async views(rows: ReportRow[]): Promise<ReportView[]> {
    if (!rows.length) return [];
    const ids = (type: ReportRow['ownerType']) =>
      rows.filter((r) => r.ownerType === type).map((r) => r.ownerId);
    const targets = new Map<string, { code: string; name: string }>();
    const unitIds = ids('unit');
    if (unitIds.length) {
      const unitRows = await many(this.db.select().from(units).where(inArray(units.id, unitIds)));
      for (const b of await this.units.briefs(unitRows))
        targets.set(b.id, { code: b.code, name: b.name });
    }
    const partIds = ids('part');
    if (partIds.length)
      for (const p of await many(
        this.db
          .select({ id: parts.id, code: parts.code, name: parts.name })
          .from(parts)
          .where(inArray(parts.id, partIds)),
      ))
        targets.set(p.id, { code: p.code, name: p.name });
    const placeIds = ids('location');
    if (placeIds.length)
      for (const l of await many(
        this.db
          .select({
            id: locations.id,
            code: locations.code,
            name: locations.name,
            kind: locations.kind,
          })
          .from(locations)
          .where(inArray(locations.id, placeIds)),
      ))
        targets.set(l.id, { code: l.code, name: placeName(l) });
    const userIds = [
      ...new Set(rows.flatMap((r) => [r.userId, r.resolvedBy]).filter((x): x is string => !!x)),
    ];
    const names = new Map(
      userIds.length
        ? (await many(this.db.select().from(users).where(inArray(users.id, userIds)))).map((u) => [
            u.id,
            u.name,
          ])
        : [],
    );
    return rows.map((r) => ({
      id: r.id,
      owner: r.ownerType,
      target: targets.get(r.ownerId) ?? { code: '?', name: '(removed)' },
      kind: r.kind,
      note: detail(r.note),
      by: personName(r.userId ? names.get(r.userId) : r.reporterName),
      guest: !r.userId,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      resolvedBy: r.resolvedBy ? personName(names.get(r.resolvedBy)) : null,
      resolution: detail(r.resolution),
    }));
  }
}
