import { buildCodeUrl, normalizeCode, type CodeInfo, type LabelBatch } from '@ixfwms/domain';
import { asc, eq, inArray, isNotNull, like } from 'drizzle-orm';
import { many, one, type Db } from '../db/client.js';
import { categories, codes, locations, parts, stockLots, units, users } from '../db/schema.js';
import { invalid } from '../lib/errors.js';
import type { LabelData } from '../labels/render.js';
import { allocateCode, claimCode, lookupCode, reserveCodes, retireCode } from './codes.js';
import { audit, requireScope, type Actor } from './context.js';
import type { LocationRow, LocationService } from './locations.js';

const MAX_BLANK = 500;

/** Collects what goes on labels: the QR URL plus the text printed next to it. */
export class LabelService {
  constructor(
    private readonly db: Db,
    private readonly locations: LocationService,
  ) {}

  /** What a scanned or typed code is: a place, a part, a blank label, or nothing yet. */
  lookup(code: string): Promise<CodeInfo> {
    return lookupCode(this.db, code);
  }

  async forCodes(codes: string[], baseUrl: string): Promise<LabelData[]> {
    const out: LabelData[] = [];
    for (const raw of codes) {
      const info = await lookupCode(this.db, raw);
      if (info.assigned === 'location')
        out.push(await this.locationLabel(await this.locations.resolve(info.code), baseUrl));
      else if (info.assigned === 'part') out.push(await this.partLabel(info.code, baseUrl));
      else if (info.assigned === 'unit') out.push(await this.unitLabel(info.code, baseUrl));
      else out.push(blankLabel(info.code, baseUrl));
    }
    return out;
  }

  /** Labels for a place and, optionally, everything inside it (sub-places and/or the parts stored there). */
  async forLocation(
    ref: string,
    opts: { recursive: boolean; include: 'locations' | 'parts' | 'all' },
    baseUrl: string,
  ): Promise<LabelData[]> {
    const root = await this.locations.resolve(ref);
    const rows = opts.recursive
      ? await many(
          this.db
            .select()
            .from(locations)
            .where(like(locations.path, `${root.path}%`))
            .orderBy(locations.path),
        )
      : [root];
    const out: LabelData[] = [];
    if (opts.include !== 'parts')
      for (const row of rows) out.push(await this.locationLabel(row, baseUrl));
    if (opts.include !== 'locations') {
      const lots = await many(
        this.db
          .select({ code: parts.code })
          .from(stockLots)
          .innerJoin(parts, eq(parts.id, stockLots.partId))
          .where(
            inArray(
              stockLots.locationId,
              rows.map((r) => r.id),
            ),
          ),
      );
      for (const code of [...new Set(lots.map((l) => l.code))])
        out.push(await this.partLabel(code, baseUrl));
      const unitRows = await many(
        this.db
          .select({ code: units.code })
          .from(units)
          .where(
            inArray(
              units.locationId,
              rows.map((r) => r.id),
            ),
          ),
      );
      for (const { code } of unitRows) out.push(await this.unitLabel(code, baseUrl));
    }
    return out;
  }

  /** Reserves fresh codes and returns blank labels to print in bulk and stick on boxes later. */
  async blank(count: number, actor: Actor | null, baseUrl: string): Promise<LabelData[]> {
    const who = requireScope(actor, 'inventory');
    if (!Number.isInteger(count) || count < 1 || count > MAX_BLANK)
      throw invalid('labels.blankCount', { max: MAX_BLANK });
    const codes = await this.db.transaction((tx) => reserveCodes(tx, count, who.userId));
    return codes.map((code) => blankLabel(code, baseUrl));
  }

  /** Reserved-label batches, newest first, with the codes not stuck on anything yet. */
  async batches(): Promise<LabelBatch[]> {
    const rows = await many(
      this.db
        .select({ r: codes, user: users.name })
        .from(codes)
        .leftJoin(users, eq(users.id, codes.createdBy))
        .where(isNotNull(codes.reservedAt))
        .orderBy(asc(codes.createdAt)),
    );
    const byBatch = new Map<string, LabelBatch>();
    for (const { r, user } of rows) {
      const key = r.batchId ?? 'none';
      const batch = byBatch.get(key) ?? {
        id: r.batchId,
        createdAt: r.createdAt,
        createdBy: user,
        unused: [],
        used: 0,
        retired: 0,
      };
      if (r.retiredAt) batch.retired++;
      else if (r.claimedAt || r.ownerType) batch.used++;
      else batch.unused.push(r.code);
      byBatch.set(key, batch);
    }
    return [...byBatch.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Labels of a batch again (e.g. the printout got lost): only the codes still unused. */
  async batchLabels(batchId: string | null, baseUrl: string): Promise<LabelData[]> {
    const batch = (await this.batches()).find((b) => b.id === batchId);
    return (batch?.unused ?? []).map((code) => blankLabel(code, baseUrl));
  }

  /** Throws away unused blank codes (lost or damaged labels). Codes in use must be changed instead. */
  async retire(codes: string[], actor: Actor | null): Promise<number> {
    const who = requireScope(actor, 'inventory');
    await this.db.transaction(async (tx) => {
      for (const raw of codes) {
        const info = await lookupCode(tx, raw);
        if (info.assigned)
          throw invalid(`labels.changeInstead.${info.assigned}`, { code: info.code });
        await retireCode(tx, info.code, 'retired by hand');
      }
      await audit(tx, who, 'retire-codes', 'label', codes.join(','), { codes });
    });
    return codes.length;
  }

  /**
   * Gives a place or part a different code: the one on the sticker actually stuck on it
   * (`newCode`), or a fresh one to print. The old code is retired, so an old sticker can't
   * point at the wrong thing.
   */
  async changeCode(
    kind: 'location' | 'part' | 'unit',
    ref: string,
    newCode: string | null,
    actor: Actor | null,
  ): Promise<string> {
    const who = requireScope(actor, 'inventory');
    return this.db.transaction(async (tx) => {
      const row =
        kind === 'location'
          ? await this.locations.resolve(ref, tx)
          : kind === 'part'
            ? await one(
                tx
                  .select()
                  .from(parts)
                  .where(eq(parts.code, normalizeCode(ref))),
              )
            : await one(
                tx
                  .select({ id: units.id, code: units.code, name: units.name })
                  .from(units)
                  .where(eq(units.code, normalizeCode(ref))),
              );
      if (!row) throw invalid(kind === 'unit' ? 'labels.noUnit' : 'labels.noPart', { ref });
      const code = newCode ? await claimCode(tx, newCode) : await allocateCode(tx);
      if (kind === 'location')
        await tx.update(locations).set({ code }).where(eq(locations.id, row.id));
      else if (kind === 'part') await tx.update(parts).set({ code }).where(eq(parts.id, row.id));
      else await tx.update(units).set({ code }).where(eq(units.id, row.id));
      const what = kind === 'location' ? 'place' : kind === 'part' ? 'part' : 'unit';
      await retireCode(tx, row.code, `was ${what} ${row.name ?? row.code}`);
      await audit(tx, who, 'code', kind, row.id, { from: row.code, to: code });
      return code;
    });
  }

  /** Two places whose labels got switched: swap their codes so the stickers are right again. */
  async swapCodes(refA: string, refB: string, actor: Actor | null): Promise<void> {
    const who = requireScope(actor, 'inventory');
    await this.db.transaction(async (tx) => {
      const a = await this.locations.resolve(refA, tx);
      const b = await this.locations.resolve(refB, tx);
      if (a.id === b.id) throw invalid('labels.twoPlaces');
      const temp = await allocateCode(tx);
      await tx.update(locations).set({ code: temp }).where(eq(locations.id, a.id));
      await tx.update(locations).set({ code: a.code }).where(eq(locations.id, b.id));
      await tx.update(locations).set({ code: b.code }).where(eq(locations.id, a.id));
      await audit(tx, who, 'swap-codes', 'location', a.id, { with: b.id, codes: [a.code, b.code] });
    });
  }

  private async locationLabel(row: LocationRow, baseUrl: string): Promise<LabelData> {
    const path = await this.locations.pathOf(row);
    const summary = path[path.length - 1];
    return {
      code: row.code,
      kind: 'location',
      name: row.name,
      path: path
        .slice(0, -1)
        .map((p) => p.name)
        .join(' › '),
      type: summary?.type ?? '',
      qr: buildCodeUrl(baseUrl, 'location', row.code),
      address: summary?.address ?? '',
      parent: summary?.within ?? '',
      short: summary?.short ?? '',
      movable: summary?.movable ?? false,
    };
  }

  /**
   * A unit's label: its own name (or the item's) and its home address, with the item and serial
   * number below. The address goes in `address`, so P-touch templates can print it too.
   */
  private async unitLabel(code: string, baseUrl: string): Promise<LabelData> {
    const row = await one(
      this.db
        .select({
          name: units.name,
          serial: units.serialNo,
          part: parts.name,
          homeId: units.homeLocationId,
        })
        .from(units)
        .innerJoin(parts, eq(parts.id, units.partId))
        .where(eq(units.code, code)),
    );
    const home = row?.homeId
      ? await this.locations.summarize(this.db, await this.locations.resolve(row.homeId))
      : null;
    return {
      code,
      kind: 'unit',
      name: row?.name ?? row?.part ?? '',
      path: [row?.name ? row.part : null, row?.serial ? `S/N ${row.serial}` : null]
        .filter(Boolean)
        .join(' · '),
      type: 'unit',
      qr: buildCodeUrl(baseUrl, 'unit', code),
      ...NO_ADDRESS,
      // A movable home (a case, a box) has no address; its name says where.
      address: home ? home.address || home.name : '',
    };
  }

  private async partLabel(code: string, baseUrl: string): Promise<LabelData> {
    const row = await one(
      this.db
        .select({ code: parts.code, name: parts.name, category: categories.path })
        .from(parts)
        .leftJoin(categories, eq(categories.id, parts.categoryId))
        .where(eq(parts.code, code)),
    );
    return {
      code,
      kind: 'part',
      name: row?.name ?? '',
      path: row?.category ?? '',
      type: 'part',
      qr: buildCodeUrl(baseUrl, 'part', code),
      ...NO_ADDRESS,
    };
  }
}

function blankLabel(code: string, baseUrl: string): LabelData {
  return {
    code,
    kind: 'blank',
    name: '',
    path: '',
    type: '',
    qr: buildCodeUrl(baseUrl, 'location', code),
    ...NO_ADDRESS,
  };
}

const NO_ADDRESS = { address: '', parent: '', short: '', movable: false };
