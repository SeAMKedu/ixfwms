import { join } from 'node:path';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { pendingMigrations, runMigrations } from '../db/migrate.js';
import { AuthService } from './auth.js';
import { BackupService } from './backup.js';
import { ExportService } from './export.js';
import { FileService } from './files.js';
import { LocationViews } from './location-views.js';
import { LocationService } from './locations.js';
import { PartResolver, PartService } from './parts.js';
import { StockService } from './stock.js';

export type { Actor } from './context.js';

export interface Services {
  auth: AuthService;
  backup: BackupService;
  export: ExportService;
  files: FileService;
  locations: LocationService;
  locationViews: LocationViews;
  parts: PartService;
  stock: StockService;
}

export function createServices(
  database: Database,
  config: Pick<Config, 'dataDir' | 'backupKeep'>,
): Services {
  const { db } = database;
  const locations = new LocationService(db);
  const resolver = new PartResolver(db);
  const files = new FileService(db, join(config.dataDir, 'files'), locations, resolver);
  const stock = new StockService(db, locations, resolver);
  const parts = new PartService(db, resolver, locations, stock, files);
  return {
    auth: new AuthService(db),
    backup: new BackupService(database.client, join(config.dataDir, 'backups'), config.backupKeep),
    export: new ExportService(db),
    files,
    locations,
    locationViews: new LocationViews(db, locations, parts, files),
    parts,
    stock,
  };
}

/** Brings the database up to date (with a backup first if there is anything to migrate) and seeds defaults. */
export async function prepareDatabase(
  database: Database,
  services: Services,
  log: (msg: string) => void,
): Promise<void> {
  const pending = await pendingMigrations(database);
  if (pending > 0) {
    const hasData = (
      await database.client.execute(
        "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'parts'",
      )
    ).rows[0]?.n;
    if (Number(hasData) > 0)
      log(`Backed up before migrating: ${await services.backup.backup('pre-migration')}`);
    await runMigrations(database);
    log(`Applied ${pending} database migration(s)`);
  }
  await services.locations.ensureDefaults();
}
