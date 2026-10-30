import { RefSchema } from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail, invalid } from '../../lib/errors.js';
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

  app.get('/api/session', async (request) => {
    const actor = request.actor;
    if (!actor) throw fail('unauthorized', 'auth.notLoggedIn');
    const home = await services.auth.home(actor.userId);
    return { name: actor.name, role: actor.role, scopes: actor.scopes, home };
  });

  /** The place you mostly work in; null for none. */
  app.put('/api/session/home', async (request) => {
    const actor = request.actor;
    if (!actor) throw fail('unauthorized', 'auth.logInFirst');
    const { home } = parse(z.object({ home: RefSchema.nullable() }), request.body);
    const place = home ? await services.locations.resolve(home) : null;
    if (place && place.kind !== 'normal') throw invalid('places.cantBeHome', { name: place.name });
    await services.auth.setHome(actor.userId, place?.id ?? null);
    return { home: await services.auth.home(actor.userId) };
  });

  app.delete('/api/session', async (request, reply) => {
    const token = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1];
    if (token) await services.auth.logout(token);
    return reply.status(204).send();
  });
}
