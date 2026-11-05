import { createReadStream, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/errors.js';
import { requireScope } from '../../lib/context.js';
import { baseUrl, parse, type AppDeps } from '../../http/context.js';

import { LabSettings, type ServerInfo, type SystemInfo } from '@ixfwms/domain';

export function systemRoutes(app: FastifyInstance, { config, services, version }: AppDeps): void {
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

/** HTTPS setup help and backups. */
export function adminRoutes(app: FastifyInstance, { config, services }: AppDeps): void {
  /** For the /setup page: is this connection HTTPS, and can we hand out the local CA certificate? */
  app.get('/api/setup', (request) => ({
    secure: request.protocol === 'https',
    certificate: !!config.caCert && existsSync(config.caCert),
    baseUrl: baseUrl(config, request),
  }));

  app.get('/api/setup/root.crt', (request, reply) => {
    if (!config.caCert || !existsSync(config.caCert)) throw fail('not_found', 'admin.noCa');
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
    if (!found) throw fail('not_found', 'admin.noBackup', { name });
    return reply
      .type('application/vnd.sqlite3')
      .header('content-disposition', `attachment; filename="${name}"`)
      .send(createReadStream(join(found.file)));
  });
}
