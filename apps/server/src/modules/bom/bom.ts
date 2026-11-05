import {
  cutsIn,
  levelState,
  isValidCode,
  parseSize,
  piecesIn,
  type Piece,
  normalizeCode,
  normalizeIdentifier,
  type BomCheck,
  type BomLine,
  type BomLineResult,
  type BomStatus,
  USABLE_UNIT_STATUSES,
} from '@ixfwms/domain';
import { eq, inArray } from 'drizzle-orm';
import { many, one, type Db } from '../../db/client.js';
import { partIdentifiers, parts } from '../../db/schema.js';
import { invalid } from '../../lib/errors.js';
import { requireScope, type Actor } from '../../lib/context.js';
import type { PartRow, PartService } from '../parts/parts.js';
import type { StockService } from '../stock/stock.js';
import type { UnitService } from '../units/units.js';

const MAX_LINES = 1000;
const NAME_MATCH_SCORE = 0.75;

/** "Can we build this?": matches a parts list against stock and says what's there, where, and what's missing. */
export class BomService {
  constructor(
    private readonly db: Db,
    private readonly parts: PartService,
    private readonly stock: StockService,
    private readonly units: UnitService,
  ) {}

  async check(lines: BomLine[]): Promise<BomCheck> {
    if (lines.length > MAX_LINES) throw invalid('bom.tooManyLines', { max: MAX_LINES });
    const byIdent = await this.partsByIdentifier(lines);
    const results: BomLineResult[] = [];
    for (const [i, line] of lines.entries())
      results.push(await this.checkLine(i + 1, line, byIdent));

    const counted = results.filter((r) => r.part);
    const missing = results.filter((r) => r.status === 'missing').length;
    const short = results.filter((r) => r.status === 'short').length;
    const judged =
      counted.every((r) => !r.uncounted || r.available >= r.quantity) &&
      counted.length === results.length;
    const buildable =
      missing > 0
        ? 0
        : judged
          ? Math.min(...counted.map((r) => Math.floor(r.available / r.quantity)))
          : null;
    return { lines: results, buildable: results.length === 0 ? 0 : buildable, missing, short };
  }

  /** Tags every matched part with a project name, so the project's parts can be listed later. All or none. */
  async tagProject(codes: string[], tag: string, actor: Actor | null): Promise<number> {
    const who = requireScope(actor, 'inventory');
    await this.db.transaction(async (tx) => {
      for (const code of codes) await this.parts.updateWithin(tx, code, { addTags: [tag] }, who);
    });
    return codes.length;
  }

  private async checkLine(
    line: number,
    input: BomLine,
    byIdent: Map<string, PartRow>,
  ): Promise<BomLineResult> {
    const base = {
      line,
      ref: input.ref ?? null,
      name: input.name ?? null,
      quantity: input.quantity,
      candidates: [] as BomLineResult['candidates'],
      size: null as Piece | null,
    };
    let part: PartRow | undefined;
    let match: BomLineResult['match'] = 'none';
    if (input.ref) {
      const code = normalizeCode(input.ref);
      part = isValidCode(code)
        ? await one(this.db.select().from(parts).where(eq(parts.code, code)))
        : undefined;
      part ??= byIdent.get(normalizeIdentifier(input.ref));
      if (part) match = 'exact';
    }
    if (!part && input.name) {
      const similar = await this.parts.findSimilar(input.name, []);
      base.candidates = similar
        .slice(0, 3)
        .map((s) => ({ code: s.code, name: s.name, score: s.score }));
      const best = similar[0];
      if (best && best.score >= NAME_MATCH_SCORE) {
        part = await this.parts.resolve(best.code);
        match = 'similar';
      }
    }
    if (!part)
      return {
        ...base,
        match: 'none',
        part: null,
        available: 0,
        salvageable: 0,
        uncounted: false,
        status: 'missing',
        where: [],
      };

    const lots = await this.stock.lotsOfPart(part.id);
    const levels = await this.stock.levels();
    let available = 0;
    let salvageable = 0;
    let uncounted = false;
    let plenty = false;
    // Cut stock with a size: how many pieces that size could be cut.
    const size = part.cut && input.size ? parseSize(input.size, part.cut) : null;
    base.size = size;
    for (const lot of lots) {
      const n = size
        ? cutsIn(lot.amount, size, levels)
        : piecesIn(lot.amount, part.unitMassG, levels);
      // Built into something: could be had by taking it apart, but isn't free.
      if (lot.location.inBuild) salvageable += n ?? 0;
      else if (n != null) available += n;
      else {
        // There is some, nobody has said how much: it may well be enough, unless it's low.
        uncounted = true;
        if (lot.amount.mode !== 'level' || levelState(lot.amount.level, levels) === 'ok')
          plenty = true;
      }
    }
    const units = ((await this.units.briefsForParts([part.id])).get(part.id) ?? []).filter(
      (u) => USABLE_UNIT_STATUSES.includes(u.status) && !u.loan,
    );
    for (const u of units) {
      if (u.location.inBuild) salvageable++;
      else available++;
    }
    const status: BomStatus =
      available >= input.quantity
        ? 'ok'
        : uncounted
          ? plenty
            ? 'unknown'
            : 'short'
          : available > 0
            ? 'short'
            : 'missing';
    return {
      ...base,
      match,
      part: { code: part.code, name: part.name, manufacturer: part.manufacturer },
      available,
      salvageable,
      uncounted,
      status,
      where: [
        ...lots.map((l) => ({
          code: l.location.code,
          path: l.path.map((p) => p.name).join(' › '),
          display: l.display,
          build: l.location.inBuild,
        })),
        ...units.map((u) => ({
          code: u.location.code,
          path: u.location.name,
          display: u.name,
          build: u.location.inBuild,
        })),
      ],
    };
  }

  private async partsByIdentifier(lines: BomLine[]): Promise<Map<string, PartRow>> {
    const keys = [
      ...new Set(
        lines
          .map((l) => l.ref)
          .filter((r): r is string => !!r)
          .map(normalizeIdentifier),
      ),
    ];
    const map = new Map<string, PartRow>();
    if (keys.length === 0) return map;
    const hits = await many(
      this.db
        .select({ key: partIdentifiers.valueNormalised, part: parts })
        .from(partIdentifiers)
        .innerJoin(parts, eq(parts.id, partIdentifiers.partId))
        .where(inArray(partIdentifiers.valueNormalised, keys)),
    );
    for (const h of hits) if (!map.has(h.key)) map.set(h.key, h.part);
    return map;
  }
}
