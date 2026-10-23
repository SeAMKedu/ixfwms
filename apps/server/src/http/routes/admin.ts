import { createReadStream, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requireScope } from '../../services/context.js';
import { baseUrl, parse, type AppDeps } from '../context.js';

/** History with undo, HTTPS setup help, and backups. */
export function registerAdminRoutes(app: FastifyInstance, { config, services }: AppDeps): void {
  app.get('/api/history', async (request) => {
    const { limit } = parse(
      z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }),
      request.query,
    );
    return services.history.recent(limit);
  });

  app.post('/api/history/undo', async (request, reply) => {
    const body = parse(
      z.object({ kind: z.enum(['stock', 'location']), id: z.string() }),
      request.body,
    );
    await services.history.undo(body.kind, body.id, request.actor);
    return reply.status(204).send();
  });

  /** For the /setup page: is this connection HTTPS, and can we hand out the local CA certificate? */
  app.get('/api/setup', (request) => ({
    secure: request.protocol === 'https',
    certificate: !!config.caCert && existsSync(config.caCert),
    baseUrl: baseUrl(config, request),
  }));

  app.get('/api/setup/root.crt', (request, reply) => {
    if (!config.caCert || !existsSync(config.caCert))
      throw new AppError('not_found', 'No local certificate authority is configured (IXF_CA_CERT)');
    return reply
      .type('application/x-x509-ca-cert')
      .header('content-disposition', 'attachment; filename="ixfwms-root.crt"')
      .send(createReadStream(config.caCert));
  });

  app.get('/api/backups', async (request) => {
    requireScope(request.actor, 'admin');
    return (await services.backup.list()).map((b) => ({ name: basename(b.file), size: b.size }));
  });

  app.get('/api/backups/:name', async (request, reply) => {
    requireScope(request.actor, 'admin');
    const { name } = parse(
      z.object({ name: z.string().regex(/^ixfwms-[\w.-]+\.db$/) }),
      request.params,
    );
    const found = (await services.backup.list()).find((b) => basename(b.file) === name);
    if (!found) throw new AppError('not_found', `No backup ${name}`);
    return reply
      .type('application/vnd.sqlite3')
      .header('content-disposition', `attachment; filename="${name}"`)
      .send(createReadStream(join(found.file)));
  });
}
