import { SCOPES, USER_ROLES } from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requireScope } from '../../services/context.js';
import { parse, type AppDeps } from '../context.js';

const NameParams = z.object({ name: z.string() });

/** User and token administration (admin scope), plus changing your own password. */
export function registerUserRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { auth } = services;

  app.get('/api/users', async (request) => {
    requireScope(request.actor, 'admin');
    return auth.listUsersWithTokens();
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
      z.object({ role: z.enum(USER_ROLES).optional(), password: z.string().max(500).optional() }),
      request.body,
    );
    if (body.role) await auth.setRole(name, body.role);
    if (body.password) await auth.setPassword(name, body.password);
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
    if (!request.actor) throw new AppError('unauthorized', 'Log in first');
    const body = parse(
      z.object({ current: z.string().min(1).max(500), next: z.string().max(500) }),
      request.body,
    );
    await auth.changeOwnPassword(request.actor.userId, body.current, body.next);
    return reply.status(204).send();
  });
}
