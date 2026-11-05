import { hasScope, SCOPES, UserSettingsInput } from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/errors.js';
import { requireScope, type Actor } from '../../lib/context.js';
import { OPEN, parse, type AppDeps } from '../../http/context.js';

import { USER_ROLES } from '@ixfwms/domain';
import { invalid } from '../../lib/errors.js';

const NameParams = z.object({ name: z.string() });

/** Saves what's given of someone's default location and language. */
async function saveUserSettings(
  services: AppDeps['services'],
  name: string,
  input: UserSettingsInput,
): Promise<void> {
  const patch: Parameters<typeof services.auth.updateSettings>[1] = {};
  if (input.language !== undefined) patch.language = input.language;
  if (input.home !== undefined) {
    const place = input.home ? await services.locations.resolve(input.home) : null;
    if (place && place.kind !== 'normal') throw invalid('places.cantBeHome', { name: place.name });
    patch.homeLocationId = place?.id ?? null;
  }
  await services.auth.updateSettings(name, patch);
}

/** User and token administration (admin scope), plus changing your own password. */
export function usersRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { auth } = services;

  app.get('/api/users', async (request) => {
    requireScope(request.actor, 'admin');
    return auth.listUsersWithTokens();
  });

  /** Just the names, for anyone who can lend things out. */
  app.get('/api/people', async (request) => {
    requireScope(request.actor, 'inventory');
    return auth.people();
  });

  app.get('/api/users/:name', async (request) => {
    requireScope(request.actor, 'admin');
    return auth.userDetail(parse(NameParams, request.params).name);
  });

  /** Turn off: no logins, tokens revoked, history kept. */
  app.post('/api/users/:name/deactivate', async (request, reply) => {
    const who = requireScope(request.actor, 'admin');
    await auth.deactivate(parse(NameParams, request.params).name, who);
    return reply.status(204).send();
  });

  app.post('/api/users/:name/reactivate', async (request, reply) => {
    requireScope(request.actor, 'admin');
    await auth.reactivate(parse(NameParams, request.params).name);
    return reply.status(204).send();
  });

  /** Only users without history; others are turned off instead. */
  app.delete('/api/users/:name', async (request, reply) => {
    const who = requireScope(request.actor, 'admin');
    await auth.deleteUser(parse(NameParams, request.params).name, who);
    return reply.status(204).send();
  });

  /** GDPR erasure: the account goes, its history stays under "Removed user". */
  app.post('/api/users/:name/erase', async (request, reply) => {
    const who = requireScope(request.actor, 'admin');
    await auth.erase(parse(NameParams, request.params).name, who);
    return reply.status(204).send();
  });

  app.post('/api/users', async (request, reply) => {
    requireScope(request.actor, 'admin');
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(100),
        role: z.enum(USER_ROLES).default('member'),
        password: z.string().max(500).nullish(),
      }),
      request.body,
    );
    await auth.createUser(body.name, body.role);
    if (body.password) await auth.setPassword(body.name, body.password);
    return reply.status(201).send({ name: body.name, role: body.role });
  });

  app.patch('/api/users/:name', async (request, reply) => {
    requireScope(request.actor, 'admin');
    const { name } = parse(NameParams, request.params);
    const body = parse(
      UserSettingsInput.extend({
        role: z.enum(USER_ROLES).optional(),
        password: z.string().max(500).optional(),
      }),
      request.body,
    );
    if (body.role) await auth.setRole(name, body.role);
    if (body.password) await auth.setPassword(name, body.password);
    await saveUserSettings(services, name, body);
    return reply.status(204).send();
  });

  /** The token is returned once and never again. */
  app.post('/api/users/:name/tokens', async (request, reply) => {
    requireScope(request.actor, 'admin');
    const { name } = parse(NameParams, request.params);
    const body = parse(
      z.object({ name: z.string().trim().min(1).max(100), scopes: z.array(z.enum(SCOPES)).min(1) }),
      request.body,
    );
    return reply.status(201).send(await auth.createToken(name, body.name, body.scopes));
  });

  app.delete('/api/tokens/:id', async (request, reply) => {
    requireScope(request.actor, 'admin');
    await auth.revokeToken(parse(z.object({ id: z.string() }), request.params).id);
    return reply.status(204).send();
  });

  app.post('/api/session/password', async (request, reply) => {
    if (!request.actor) throw fail('unauthorized', 'auth.logInFirst');
    const body = parse(
      z.object({ current: z.string().min(1).max(500), next: z.string().max(500) }),
      request.body,
    );
    const session = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1];
    await auth.changeOwnPassword(request.actor.userId, body.current, body.next, session);
    return reply.status(204).send();
  });
}

/** Web login. The returned token is sent as a Bearer token like any API token. */
export function sessionRoutes(app: FastifyInstance, { services }: AppDeps): void {
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
