import type { Db } from '../db/client.js';
import * as schema from '../db/schema.js';

const EXPORTED = {
  locationTypes: schema.locationTypes,
  locations: schema.locations,
  categories: schema.categories,
  parts: schema.parts,
  partIdentifiers: schema.partIdentifiers,
  tags: schema.tags,
  partTags: schema.partTags,
  stockLots: schema.stockLots,
  stockMovements: schema.stockMovements,
  locationMoves: schema.locationMoves,
  files: schema.files,
  attachments: schema.attachments,
} as const;

/** Full JSON export of the inventory (no users or tokens), so the data is never locked in. */
export class ExportService {
  constructor(private readonly db: Db) {}

  async exportAll(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {
      format: 'ixfwms-export',
      version: 1,
      exportedAt: new Date().toISOString(),
    };
    for (const [name, table] of Object.entries(EXPORTED)) {
      out[name] = await this.db.select().from(table).all();
    }
    return out;
  }
}
