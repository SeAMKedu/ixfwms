import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { ZodError } from 'zod';
import { errorMessage } from '@ixfwms/domain';
import { AppError, fail, ruleConflict } from '../lib/errors.js';
import { viewAs } from '../lib/context.js';
import { registerMcp } from '../mcp/http.js';
import { ROUTES } from '../modules/index.js';
import type { AppDeps } from './context.js';
import { registerPageRoutes } from './pages.js';
import { defaultWebDir, registerWebApp } from './web.js';

const CHANGES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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
    if (header) {
      const match = /^Bearer\s+(\S+)$/i.exec(header);
      const actor = match?.[1] ? await services.auth.verify(match[1]) : null;
      if (!actor) throw fail('unauthorized', 'auth.unknownToken');
      request.actor = actor;
    }
    // Changes need a login unless the route is marked OPEN, so a new route can't forget it.
    if (!request.actor && CHANGES.has(request.method) && !request.routeOptions.config.open)
      throw fail('unauthorized', 'auth.needToken');
  });
  // Without a login, the handler's views leave people's names out, and maybe more.
  app.addHook('preHandler', (request, _reply, done) => {
    if (request.actor) return viewAs(request.actor, done);
    services.settings.get().then(
      (s) => viewAs(null, done, s.anonymousView === 'limited'),
      (err: Error) => done(err),
    );
  });

  app.setErrorHandler((raw, request, reply) => {
    const error = ruleConflict(raw) ?? raw;
    if (error instanceof AppError) {
      return reply.status(error.status).send({
        error: error.code,
        message: error.message,
        key: error.key,
        params: error.params,
        details: error.details,
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'invalid',
        message: errorMessage('input.invalid'),
        key: 'input.invalid',
        details: error.issues,
      });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: 'invalid', message: (error as Error).message });
    }
    request.log.error(error);
    return reply.status(500).send({
      error: 'internal',
      message: errorMessage('server.internal'),
      key: 'server.internal',
    });
  });

  for (const routes of ROUTES) routes(app, deps);
  registerMcp(app, deps);
  // The built web app takes over the HTML routes; without a build, minimal server pages stand in.
  if (!(await registerWebApp(app, config.webDir ?? defaultWebDir()))) registerPageRoutes(app, deps);
  return app;
}
