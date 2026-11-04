import { hasScope, SCOPES, UserSettingsInput } from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/errors.js';
import { requireScope, type Actor } from '../../services/context.js';
import { OPEN, parse, type AppDeps } from '../context.js';
import { saveUserSettings } from './users.js';

/** Web login. The returned token is sent as a Bearer token like any API token. */
export function registerSessionRoutes(app: FastifyInstance, { services }: AppDeps): void {
  app.post('/api/session', OPEN, async (request, reply) => {
    const body = parse(
      z.object({ name: z.string().trim().min(1).max(100), password: z.string().min(1).max(500) }),
      request.body,
    );
    return reply.status(201).send(await services.auth.login(body.name, body.password));
  });

  app.get('/api/session', async (request) => {
    const actor = request.actor;
    if (!actor) throw fail('unauthorized', 'auth.notLoggedIn');
    const settings = await services.auth.settings(actor.userId);
    return { name: actor.name, role: actor.role, scopes: actor.scopes, ...settings };
  });

  /** Your default location and language. */
  app.patch('/api/session', async (request) => {
    const actor = request.actor;
    if (!actor) throw fail('unauthorized', 'auth.logInFirst');
    await saveUserSettings(services, actor.name, parse(UserSettingsInput, request.body));
    return services.auth.settings(actor.userId);
  });

  /** Your own API tokens: members and admins, from a web login, up to what you may do yourself. */
  const tokenOwner = (actor: Actor | null): Actor => {
    const who = requireScope(actor, 'inventory');
    if (!who.webLogin) throw fail('forbidden', 'auth.webLoginOnly');
    return who;
  };

  app.get('/api/session/tokens', async (request) => {
    const who = tokenOwner(request.actor);
    const users = await services.auth.listUsersWithTokens();
    return users.find((u) => u.id === who.userId)?.tokens ?? [];
  });

  app.post('/api/session/tokens', async (request, reply) => {
    const who = tokenOwner(request.actor);
    const body = parse(
      z.object({ name: z.string().trim().min(1).max(100), scopes: z.array(z.enum(SCOPES)).min(1) }),
      request.body,
    );
    for (const scope of body.scopes)
      if (!hasScope(who.scopes, scope)) throw fail('forbidden', 'auth.needScope', { scope });
    return reply
      .status(201)
      .send(await services.auth.createToken(who.name, body.name, body.scopes));
  });

  app.delete('/api/session/tokens/:id', async (request, reply) => {
    const who = tokenOwner(request.actor);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    await services.auth.revokeOwnToken(who.userId, id);
    return reply.status(204).send();
  });

  app.delete('/api/session', OPEN, async (request, reply) => {
    const token = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1];
    if (token) await services.auth.logout(token);
    return reply.status(204).send();
  });
}
