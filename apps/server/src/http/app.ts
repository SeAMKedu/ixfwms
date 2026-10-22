import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { registerMcp } from '../mcp/http.js';
import type { AppDeps } from './context.js';
import { registerCarryRoutes } from './routes/carry.js';
import { registerFileRoutes } from './routes/files.js';
import { registerImportRoutes } from './routes/import.js';
import { registerLabelRoutes } from './routes/labels.js';
import { registerLocationRoutes } from './routes/locations.js';
import { registerPageRoutes } from './routes/pages.js';
import { registerPartRoutes } from './routes/parts.js';
import { registerSessionRoutes } from './routes/session.js';
import { registerStockRoutes } from './routes/stock.js';
import { registerSystemRoutes } from './routes/system.js';
import { defaultWebDir, registerWebApp } from './web.js';

export async function buildApp(
  deps: AppDeps,
  logger: FastifyServerOptions['logger'] = false,
): Promise<FastifyInstance> {
  const { config, services } = deps;
  const app = Fastify({ logger, trustProxy: config.trustProxy, bodyLimit: 5 * 1024 * 1024 });

  await app.register(multipart, {
    limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  });

  app.decorateRequest('actor', null);
  app.addHook('onRequest', async (request) => {
    const header = request.headers.authorization;
    if (!header) return;
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    const actor = match?.[1] ? await services.auth.verify(match[1]) : null;
    if (!actor) throw new AppError('unauthorized', 'Unknown or revoked API token');
    request.actor = actor;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.status)
        .send({ error: error.code, message: error.message, details: error.details });
    }
    if (error instanceof ZodError) {
      return reply
        .status(400)
        .send({ error: 'invalid', message: 'Invalid input', details: error.issues });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: 'invalid', message: (error as Error).message });
    }
    request.log.error(error);
    return reply
      .status(500)
      .send({ error: 'internal', message: 'Something went wrong on the server' });
  });

  registerSystemRoutes(app, deps);
  registerSessionRoutes(app, deps);
  registerLocationRoutes(app, deps);
  registerPartRoutes(app, deps);
  registerStockRoutes(app, deps);
  registerFileRoutes(app, deps);
  registerLabelRoutes(app, deps);
  registerCarryRoutes(app, deps);
  registerImportRoutes(app, deps);
  registerMcp(app, deps);
  // The built web app takes over the HTML routes; without a build, minimal server pages stand in.
  if (!(await registerWebApp(app, config.webDir ?? defaultWebDir()))) registerPageRoutes(app, deps);
  return app;
}
