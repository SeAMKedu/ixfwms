import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/errors.js';
import { parse, type AppDeps } from '../context.js';

/** Web login. The returned token is sent as a Bearer token like any API token. */
export function registerSessionRoutes(app: FastifyInstance, { services }: AppDeps): void {
  app.post('/api/session', async (request, reply) => {
    const body = parse(
      z.object({ name: z.string().trim().min(1).max(100), password: z.string().min(1).max(500) }),
      request.body,
    );
    return reply.status(201).send(await services.auth.login(body.name, body.password));
  });

  app.get('/api/session', (request) => {
    const actor = request.actor;
    if (!actor) throw fail('unauthorized', 'auth.notLoggedIn');
    return { name: actor.name, role: actor.role, scopes: actor.scopes };
  });

  app.delete('/api/session', async (request, reply) => {
    const token = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1];
    if (token) await services.auth.logout(token);
    return reply.status(204).send();
  });
}
