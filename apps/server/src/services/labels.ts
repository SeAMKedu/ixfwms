import { buildCodeUrl, type CodeInfo } from '@ixfwms/domain';
import { eq, inArray, like } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { categories, locations, parts, stockLots } from '../db/schema.js';
import { invalid } from '../lib/errors.js';
import type { LabelData } from '../labels/render.js';
import { lookupCode, reserveCodes } from './codes.js';
import { requireScope, type Actor } from './context.js';
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
      ? await this.db
          .select()
          .from(locations)
          .where(like(locations.path, `${root.path}%`))
          .orderBy(locations.path)
          .all()
      : [root];
    const out: LabelData[] = [];
    if (opts.include !== 'parts')
      for (const row of rows) out.push(await this.locationLabel(row, baseUrl));
    if (opts.include !== 'locations') {
      const lots = await this.db
        .select({ code: parts.code })
        .from(stockLots)
        .innerJoin(parts, eq(parts.id, stockLots.partId))
        .where(
          inArray(
            stockLots.locationId,
            rows.map((r) => r.id),
          ),
        )
        .all();
      for (const code of [...new Set(lots.map((l) => l.code))])
        out.push(await this.partLabel(code, baseUrl));
    }
    return out;
  }

  /** Reserves fresh codes and returns blank labels to print in bulk and stick on boxes later. */
  async blank(count: number, actor: Actor | null, baseUrl: string): Promise<LabelData[]> {
    const who = requireScope(actor, 'inventory');
    if (!Number.isInteger(count) || count < 1 || count > MAX_BLANK)
      throw invalid(`Ask for 1 to ${MAX_BLANK} blank labels`);
    const codes = await this.db.transaction((tx) => reserveCodes(tx, count, who.userId));
    return codes.map((code) => blankLabel(code, baseUrl));
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
    };
  }

  private async partLabel(code: string, baseUrl: string): Promise<LabelData> {
    const row = await this.db
      .select({ code: parts.code, name: parts.name, category: categories.path })
      .from(parts)
      .leftJoin(categories, eq(categories.id, parts.categoryId))
      .where(eq(parts.code, code))
      .get();
    return {
      code,
      kind: 'part',
      name: row?.name ?? '',
      path: row?.category ?? '',
      type: 'part',
      qr: buildCodeUrl(baseUrl, 'part', code),
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
  };
}
