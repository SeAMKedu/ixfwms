import { LabSettings, type ServerInfo, type SystemInfo } from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { requireScope } from '../../lib/context.js';
import { baseUrl, parse, type AppDeps } from '../../http/context.js';

export function registerSystemRoutes(
  app: FastifyInstance,
  { config, services, version }: AppDeps,
): void {
  app.get('/healthz', () => ({ ok: true, version }));

  app.get('/api/info', async (request): Promise<ServerInfo> => {
    const base = baseUrl(config, request);
    return {
      name: 'ixfwms',
      version,
      baseUrl: base,
      mcpUrl: `${base}/mcp`,
      inboxCode: (await services.locations.inbox()).code,
      you: request.actor ? { name: request.actor.name, scopes: request.actor.scopes } : null,
    };
  });

  app.get('/api/settings', () => services.settings.get());

  app.patch('/api/settings', async (request) =>
    services.settings.update(parse(LabSettings.partial(), request.body), request.actor),
  );

  /** Server settings from the environment, read-only (admins). */
  app.get('/api/system', (request): SystemInfo => {
    requireScope(request.actor, 'admin');
    return {
      version,
      publicUrl: config.publicUrl,
      dataDir: config.dataDir,
      backupHour: config.backupHour,
      backupKeep: config.backupKeep,
      maxUploadMb: config.maxUploadMb,
      node: process.version,
    };
  });

  /** Everything, people and network details included: admins only. */
  app.get('/api/export', async (request, reply) => {
    requireScope(request.actor, 'admin');
    const data = await services.export.exportAll();
    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-disposition', `attachment; filename="ixfwms-export-${stamp}.json"`)
      .send(data);
  });

  app.post('/api/backups', async (request) => {
    requireScope(request.actor, 'admin');
    return { file: await services.backup.backup('manual') };
  });
}
