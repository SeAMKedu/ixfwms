import type { HistoryEntry } from '@ixfwms/domain';
import { desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  auditLog,
  locationMoves,
  locations,
  parts,
  stockLots,
  stockMovements,
  unitEvents,
  units,
  users,
} from '../db/schema.js';
import { invalid, notFound } from '../lib/errors.js';
import { requireScope, type Actor } from './context.js';
import type { LocationService } from './locations.js';
import type { StockService } from './stock.js';

/** Edits that are interesting in the feed; the rest (stock and moves) come from their own tables. */
const EDIT_ACTIONS = [
  'create',
  'update',
  'status',
  'merge',
  'attach',
  'fields',
  'map',
  'map-removed',
];

/** Renaming, moving and deleting categories have no table of their own, so they come from the audit log. */
const CATEGORY_ACTIONS = ['move', 'delete'];

const NO_UNIT = { unit: null, value: null, text: null };

/** "What changed lately": stock changes, moves, unit events and edits in one feed, with undo for moves. */
export class HistoryService {
  constructor(
    private readonly db: Db,
    private readonly locations: LocationService,
    private readonly stock: StockService,
  ) {}

  async recent(limit = 100): Promise<HistoryEntry[]> {
    const moves = await this.db
      .select()
      .from(stockMovements)
      .orderBy(desc(stockMovements.at))
      .limit(limit)
      .all();
    const placeMoves = await this.db
      .select()
      .from(locationMoves)
      .orderBy(desc(locationMoves.at))
      .limit(limit)
      .all();
    const edits = (
      await this.db
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.at))
        .limit(limit * 2)
        .all()
    )
      // Units have their own log (unit_events), which says more than the audit rows.
      .filter(
        (a) =>
          a.entityType !== 'unit' &&
          (EDIT_ACTIONS.includes(a.action) ||
            (a.entityType === 'category' && CATEGORY_ACTIONS.includes(a.action))),
      );
    const unitRows = await this.db
      .select({
        e: unitEvents,
        code: units.code,
        name: units.name,
        partName: parts.name,
      })
      .from(unitEvents)
      .innerJoin(units, eq(units.id, unitEvents.unitId))
      .innerJoin(parts, eq(parts.id, units.partId))
      .orderBy(desc(unitEvents.at))
      .limit(limit)
      .all();

    const userIds = new Set(
      [...moves, ...placeMoves, ...edits, ...unitRows.map((r) => r.e)]
        .map((r) => r.userId)
        .filter((u): u is string => !!u),
    );
    const userNames = new Map(
      (userIds.size
        ? await this.db
            .select()
            .from(users)
            .where(inArray(users.id, [...userIds]))
            .all()
        : []
      ).map((u) => [u.id, u.name]),
    );
    const locIds = new Set<string>();
    for (const m of moves) [m.fromLocationId, m.toLocationId].forEach((id) => id && locIds.add(id));
    for (const m of placeMoves)
      [m.locationId, m.fromParentId, m.toParentId].forEach((id) => id && locIds.add(id));
    for (const e of edits) if (e.entityType === 'location') locIds.add(e.entityId);
    for (const { e } of unitRows)
      [e.fromLocationId, e.toLocationId].forEach((id) => id && locIds.add(id));
    const locs = new Map(
      (locIds.size
        ? await this.db
            .select()
            .from(locations)
            .where(inArray(locations.id, [...locIds]))
            .all()
        : []
      ).map((l) => [l.id, { code: l.code, name: l.name }]),
    );
    const partIds = new Set([
      ...moves.map((m) => m.partId),
      ...edits.filter((e) => e.entityType === 'part').map((e) => e.entityId),
    ]);
    const partRows = new Map(
      (partIds.size
        ? await this.db
            .select()
            .from(parts)
            .where(inArray(parts.id, [...partIds]))
            .all()
        : []
      ).map((p) => [p.id, { code: p.code, name: p.name }]),
    );
    const place = (id: string | null) => (id ? (locs.get(id) ?? null) : null);

    const latestMoveByLot = new Map<string, string>();
    for (const m of moves)
      if (m.lotId && !latestMoveByLot.has(m.lotId)) latestMoveByLot.set(m.lotId, m.id);
    const latestMoveByPlace = new Map<string, string>();
    for (const m of placeMoves)
      if (!latestMoveByPlace.has(m.locationId)) latestMoveByPlace.set(m.locationId, m.id);

    const entries: HistoryEntry[] = [
      ...moves.map((m) => ({
        kind: 'stock' as const,
        id: m.id,
        at: m.at,
        user: m.userId ? (userNames.get(m.userId) ?? null) : m.reporterName,
        action: m.reason,
        part: partRows.get(m.partId) ?? null,
        place: place(m.toLocationId ?? m.fromLocationId),
        from: place(m.fromLocationId),
        to: place(m.toLocationId),
        delta: m.delta,
        ...NO_UNIT,
        undoable: m.reason === 'move' && !!m.lotId && latestMoveByLot.get(m.lotId) === m.id,
      })),
      ...placeMoves.map((m) => ({
        kind: 'location' as const,
        id: m.id,
        at: m.at,
        user: m.userId ? (userNames.get(m.userId) ?? null) : null,
        action: 'move',
        part: null,
        place: place(m.locationId),
        from: place(m.fromParentId),
        to: place(m.toParentId),
        delta: null,
        ...NO_UNIT,
        undoable: latestMoveByPlace.get(m.locationId) === m.id,
      })),
      ...unitRows.map(({ e, code, name, partName }) => ({
        kind: 'unit' as const,
        id: e.id,
        at: e.at,
        user: e.userId ? (userNames.get(e.userId) ?? null) : e.reporterName,
        action: e.kind,
        part: null,
        place: null,
        from: place(e.fromLocationId),
        to: place(e.toLocationId),
        delta: null,
        unit: { code, name: name ?? partName },
        value: e.value,
        text: e.text,
        undoable: false,
      })),
      ...edits.map((e) => {
        const data = e.data ?? {};
        const text = (key: string) => (typeof data[key] === 'string' ? data[key] : '');
        const fallbackName = text('name') || text('path') || text('from');
        const named = (name: string) => (name ? { code: '', name } : null);
        const renamed = e.entityType === 'category' && e.action === 'move';
        return {
          kind: 'edit' as const,
          id: e.id,
          at: e.at,
          user: e.userId ? (userNames.get(e.userId) ?? null) : null,
          action: e.action,
          part:
            e.entityType === 'part'
              ? (partRows.get(e.entityId) ?? { code: '', name: fallbackName })
              : null,
          // Other things (categories, place types) are named by what the audit row recorded.
          place:
            e.entityType === 'location'
              ? (locs.get(e.entityId) ?? null)
              : e.entityType === 'part'
                ? null
                : named(fallbackName),
          from: renamed ? named(text('from')) : null,
          to: renamed ? named(text('to')) : null,
          delta: null,
          ...NO_UNIT,
          undoable: false,
        };
      }),
    ];
    return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }

  /** Puts moved stock or a moved place back where it was, if nothing has moved it since. */
  async undo(kind: 'stock' | 'location', id: string, actor: Actor | null): Promise<void> {
    const who = requireScope(actor, 'inventory');
    await this.db.transaction(async (tx) => {
      if (kind === 'location') {
        const move = await tx.select().from(locationMoves).where(eq(locationMoves.id, id)).get();
        if (!move) throw notFound('move', id);
        const loc = await this.locations.resolve(move.locationId, tx);
        if (loc.parentId !== move.toParentId)
          throw invalid('history.movedAgain', { name: loc.name });
        await this.locations.moveWithin(tx, loc, move.fromParentId, who);
        return;
      }
      const move = await tx.select().from(stockMovements).where(eq(stockMovements.id, id)).get();
      if (!move) throw notFound('move', id);
      if (move.reason !== 'move' || !move.lotId || !move.fromLocationId)
        throw invalid('history.onlyMoves');
      const lot = await tx.select().from(stockLots).where(eq(stockLots.id, move.lotId)).get();
      if (!lot || lot.locationId !== move.toLocationId) throw invalid('history.changedSince');
      if (move.delta != null && (lot.quantity ?? 0) < move.delta)
        throw invalid('history.takenSince');
      await this.stock.moveWithin(tx, lot.id, move.fromLocationId, move.delta, who);
    });
  }
}
