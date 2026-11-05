import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, type AppDeps } from '../../http/context.js';

/** "Where is the impact drill?" as short sentences. */
export function whereRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { where } = services;

  app.get('/api/where', async (request) => {
    const { q } = parse(z.object({ q: z.string().trim().min(1).max(200) }), request.query);
    return where.ask(q);
  });
}
