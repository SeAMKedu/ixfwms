import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, type AppDeps } from '../../http/context.js';

/** What changed, by whom, and undoing it. */
export function historyRoutes(app: FastifyInstance, { services }: AppDeps): void {
  app.get('/api/history', async (request) => {
    const { limit } = parse(
      z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }),
      request.query,
    );
    return services.history.recent(request.actor, limit);
  });

  app.post('/api/history/undo', async (request, reply) => {
    const body = parse(
      z.object({ kind: z.enum(['stock', 'location']), id: z.string() }),
      request.body,
    );
    await services.history.undo(body.kind, body.id, request.actor);
    return reply.status(204).send();
  });
}
