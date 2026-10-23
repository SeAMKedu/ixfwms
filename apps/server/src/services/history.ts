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

/** "What changed lately": stock changes, moves and edits in one feed, with undo for moves. */
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
    ).filter((a) => EDIT_ACTIONS.includes(a.action));

    const userIds = new Set(
      [...moves, ...placeMoves, ...edits].map((r) => r.userId).filter((u): u is string => !!u),
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
        user: m.userId ? (userNames.get(m.userId) ?? null) : null,
        action: m.reason,
        part: partRows.get(m.partId) ?? null,
        place: place(m.toLocationId ?? m.fromLocationId),
        from: place(m.fromLocationId),
        to: place(m.toLocationId),
        delta: m.delta,
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
        undoable: latestMoveByPlace.get(m.locationId) === m.id,
      })),
      ...edits.map((e) => {
        const data = e.data ?? {};
        const fallbackName =
          typeof data.name === 'string'
            ? data.name
            : typeof data.path === 'string'
              ? data.path
              : '';
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
          place:
            e.entityType === 'location'
              ? (locs.get(e.entityId) ?? null)
              : e.entityType === 'category'
                ? { code: '', name: fallbackName }
                : null,
          from: null,
          to: null,
          delta: null,
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
        if (!move) throw notFound('Move', id);
        const loc = await this.locations.resolve(move.locationId, tx);
        if (loc.parentId !== move.toParentId)
          throw invalid(`${loc.name} has been moved again since; undo that first`);
        await this.locations.moveWithin(tx, loc, move.fromParentId, who);
        return;
      }
      const move = await tx.select().from(stockMovements).where(eq(stockMovements.id, id)).get();
      if (!move) throw notFound('Move', id);
      if (move.reason !== 'move' || !move.lotId || !move.fromLocationId)
        throw invalid('Only moves can be undone');
      const lot = await tx.select().from(stockLots).where(eq(stockLots.id, move.lotId)).get();
      if (!lot || lot.locationId !== move.toLocationId)
        throw invalid('That stock has changed since; it can no longer be undone');
      if (move.delta != null && (lot.quantity ?? 0) < move.delta)
        throw invalid('Some of it has been taken since; move it back by hand');
      await this.stock.moveWithin(tx, lot.id, move.fromLocationId, move.delta, who);
    });
  }
}
