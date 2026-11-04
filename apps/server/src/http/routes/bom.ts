import { BomLine } from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OPEN, parse, type AppDeps } from '../context.js';

export function registerBomRoutes(app: FastifyInstance, { services }: AppDeps): void {
  /** Open to anyone on the lab network: checking a list changes nothing. */
  app.post('/api/bom/check', OPEN, async (request) => {
    const { lines } = parse(z.object({ lines: z.array(BomLine) }), request.body);
    return services.bom.check(lines);
  });

  app.post('/api/bom/tag', async (request) => {
    const body = parse(
      z.object({
        codes: z.array(z.string()).min(1).max(1000),
        tag: z.string().trim().min(1).max(60),
      }),
      request.body,
    );
    return { tagged: await services.bom.tagProject(body.codes, body.tag, request.actor) };
  });
}
