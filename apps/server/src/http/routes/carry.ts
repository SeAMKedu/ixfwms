import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, type AppDeps } from '../context.js';

export function registerCarryRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { carry } = services;

  app.get('/api/carry', (request) => carry.state(request.actor));

  app.post('/api/carry/pick', async (request) => {
    const body = parse(
      z.object({
        location: z.string().nullish(),
        lotId: z.string().nullish(),
        quantity: z.number().positive().nullish(),
      }),
      request.body,
    );
    return carry.pick(body, request.actor);
  });

  app.post('/api/carry/drop', async (request) => {
    const body = parse(
      z.object({ to: z.string(), items: z.array(z.string()).nullish() }),
      request.body,
    );
    return carry.drop(body.to, body.items ?? null, request.actor);
  });
}
