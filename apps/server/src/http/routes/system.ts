import type { FastifyInstance } from 'fastify';
import { requireScope } from '../../services/context.js';
import { baseUrl, type AppDeps } from '../context.js';

export function registerSystemRoutes(
  app: FastifyInstance,
  { config, services, version }: AppDeps,
): void {
  app.get('/healthz', () => ({ ok: true, version }));

  app.get('/api/info', (request) => {
    const base = baseUrl(config, request);
    return {
      name: 'ixfwms',
      version,
      baseUrl: base,
      mcpUrl: `${base}/mcp`,
      you: request.actor ? { name: request.actor.name, scopes: request.actor.scopes } : null,
    };
  });

  app.get('/api/export', async (_request, reply) => {
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
