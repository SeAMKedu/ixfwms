import { MoveAmount } from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, type AppDeps } from '../../http/context.js';

export function carryRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { carry } = services;

  app.get('/api/carry', (request) => carry.state(request.actor));

  /** Open to everyone: who is carrying what, and since when. */
  app.get('/api/carry/all', () => carry.everyone());

  app.post('/api/carry/pick', async (request) => {
    const body = parse(
      MoveAmount.extend({
        location: z.string().nullish(),
        lotId: z.string().nullish(),
        unit: z.string().nullish(),
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
