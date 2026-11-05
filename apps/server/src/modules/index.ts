import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { pendingMigrations, runMigrations } from '../db/migrate.js';
import type { AppDeps } from '../http/context.js';
import { registerAdminRoutes } from '../http/routes/admin.js';
import { registerBomRoutes } from '../http/routes/bom.js';
import { registerCarryRoutes } from '../http/routes/carry.js';
import { registerFileRoutes } from '../http/routes/files.js';
import { registerImportRoutes } from '../http/routes/import.js';
import { registerLabelRoutes } from '../http/routes/labels.js';
import { registerMapRoutes } from '../http/routes/maps.js';
import { registerPartRoutes } from '../http/routes/parts.js';
import { registerSessionRoutes } from '../http/routes/session.js';
import { registerStockRoutes } from '../http/routes/stock.js';
import { registerSystemRoutes } from '../http/routes/system.js';
import { registerUnitRoutes } from '../http/routes/units.js';
import { registerUserRoutes } from '../http/routes/users.js';
import { registerBuildTools } from '../mcp/build-tools.js';
import { coreTools } from '../mcp/core-tools.js';
import { registerDeleteTools } from '../mcp/delete-tools.js';
import { registerLostTools } from '../mcp/lost-tools.js';
import type { ToolContext } from '../mcp/tool.js';
import { LoanService } from './loans/loans.js';
import { locationRoutes } from './locations/routes.js';
import { locationTools } from './locations/tools.js';
import { loanRoutes } from './loans/routes.js';
import { loanTools } from './loans/tools.js';
import { ArchiveService } from '../services/archives.js';
import { AuthService } from '../services/auth.js';
import { BackupService } from '../services/backup.js';
import { BomService } from '../services/bom.js';
import { BuildService } from '../services/builds.js';
import { CarryService } from '../services/carry.js';
import { CategoryService } from '../services/categories.js';
import { DeleteService } from '../services/deletes.js';
import { ExportService } from '../services/export.js';
import { FileService } from '../services/files.js';
import { HistoryService } from '../services/history.js';
import { ImportService } from '../services/import.js';
import { LabelService } from '../services/labels.js';
import { LocationViews } from './locations/views.js';
import { LocationService } from './locations/locations.js';
import { MapService } from '../services/maps.js';
import { OpenActionService } from '../services/open.js';
import { PlaceTypeService } from './locations/place-types.js';
import { PartResolver, PartService } from '../services/parts.js';
import { ReportService } from '../services/reports.js';
import { fillSearchText } from '../services/search-text.js';
import { SettingsService } from '../services/settings.js';
import { StockService } from '../services/stock.js';
import { UnitService } from '../services/units.js';
import { WhereService } from '../services/where.js';
import { WriteOffService } from '../services/write-offs.js';

export type { Actor } from '../lib/context.js';

type Routes = (app: FastifyInstance, deps: AppDeps) => void;
type Tools = (server: McpServer, ctx: ToolContext) => void;

/** Every module's HTTP routes; `http/app.ts` registers them in this order. */
export const ROUTES: Routes[] = [
  registerSystemRoutes,
  registerSessionRoutes,
  locationRoutes,
  registerPartRoutes,
  registerStockRoutes,
  registerUnitRoutes,
  loanRoutes,
  registerFileRoutes,
  registerLabelRoutes,
  registerCarryRoutes,
  registerImportRoutes,
  registerBomRoutes,
  registerMapRoutes,
  registerUserRoutes,
  registerAdminRoutes,
];

/** Every module's MCP tools; `mcp/server.ts` registers them in this order. */
export const TOOLS: Tools[] = [
  coreTools,
  (server, c) => registerBuildTools(server, c.services, c.actor, c.baseUrl),
  (server, c) => registerDeleteTools(server, c.services, c.actor),
  loanTools,
  (server, c) => registerLostTools(server, c.services, c.actor),
  locationTools,
];

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
    where: new WhereService(parts, stock, locations),
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
