import { join } from 'node:path';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { pendingMigrations, runMigrations } from '../db/migrate.js';
import { ArchiveService } from './archives.js';
import { AuthService } from './auth.js';
import { BackupService } from './backup.js';
import { BomService } from './bom.js';
import { BuildService } from './builds.js';
import { CarryService } from './carry.js';
import { CategoryService } from './categories.js';
import { DeleteService } from './deletes.js';
import { ExportService } from './export.js';
import { FileService } from './files.js';
import { HistoryService } from './history.js';
import { ImportService } from './import.js';
import { LabelService } from './labels.js';
import { LocationViews } from './location-views.js';
import { LoanService } from './loans.js';
import { LocationService } from './locations.js';
import { MapService } from './maps.js';
import { OpenActionService } from './open.js';
import { PlaceTypeService } from './place-types.js';
import { PartResolver, PartService } from './parts.js';
import { ReportService } from './reports.js';
import { fillSearchText } from './search-text.js';
import { SettingsService } from './settings.js';
import { StockService } from './stock.js';
import { UnitService } from './units.js';
import { WhereService } from './where.js';
import { WriteOffService } from './write-offs.js';

export type { Actor } from './context.js';

export interface Services {
  archives: ArchiveService;
  auth: AuthService;
  backup: BackupService;
  bom: BomService;
  builds: BuildService;
  categories: CategoryService;
  deletes: DeleteService;
  carry: CarryService;
  export: ExportService;
  files: FileService;
  history: HistoryService;
  import: ImportService;
  labels: LabelService;
  loans: LoanService;
  locations: LocationService;
  locationViews: LocationViews;
  maps: MapService;
  open: OpenActionService;
  parts: PartService;
  placeTypes: PlaceTypeService;
  reports: ReportService;
  settings: SettingsService;
  stock: StockService;
  units: UnitService;
  where: WhereService;
  writeOffs: WriteOffService;
}

export function createServices(
  database: Database,
  config: Pick<Config, 'dataDir' | 'backupKeep'>,
): Services {
  const { db } = database;
  const locations = new LocationService(db);
  const resolver = new PartResolver(db);
  const files = new FileService(db, join(config.dataDir, 'files'), locations, resolver);
  const settings = new SettingsService(db);
  const stock = new StockService(db, locations, resolver, settings);
  const units = new UnitService(db, locations, resolver);
  const loans = new LoanService(db, locations, units);
  const categories = new CategoryService(db);
  const open = new OpenActionService(db, locations, stock, units, settings);
  const builds = new BuildService(db, locations, stock, units, open, resolver);
  const parts = new PartService(db, resolver, locations, stock, files, units, categories, builds);
  return {
    archives: new ArchiveService(db, locations),
    auth: new AuthService(db),
    backup: new BackupService(database.client, join(config.dataDir, 'backups'), config.backupKeep),
    bom: new BomService(db, parts, stock, units),
    builds,
    categories,
    deletes: new DeleteService(db, resolver, locations, stock, units),
    carry: new CarryService(db, locations, stock, units),
    export: new ExportService(db),
    files,
    history: new HistoryService(db, locations, stock),
    import: new ImportService(db, locations, parts, stock),
    labels: new LabelService(db, locations),
    loans,
    locations,
    locationViews: new LocationViews(db, locations, parts, files, units, builds, loans),
    maps: new MapService(db, locations, files),
    open,
    parts,
    placeTypes: new PlaceTypeService(db),
    reports: new ReportService(db, locations, resolver, units),
    settings,
    stock,
    units,
    where: new WhereService(parts, stock),
    writeOffs: new WriteOffService(db),
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
  await fillSearchText(database.db);
  await services.locations.ensureDefaults();
}
