import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, type AppDeps } from '../context.js';

const RefParams = z.object({ ref: z.string() });

export function registerMapRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { maps } = services;

  /** The drawings to show for "where is it?", from the top level down. */
  app.get('/api/maps/:ref', async (request) => maps.layers(parse(RefParams, request.params).ref));

  app.put('/api/locations/:ref/map', async (request) => {
    const { ref } = parse(RefParams, request.params);
    const { fileId } = parse(z.object({ fileId: z.string().min(1) }), request.body);
    return maps.setMap(ref, fileId, request.actor);
  });

  app.get('/api/locations/:ref/map/starter.svg', async (request, reply) => {
    const { ref } = parse(RefParams, request.params);
    return reply
      .type('image/svg+xml')
      .header('content-disposition', `attachment; filename="ixfwms-map-${ref}.svg"`)
      .send(await maps.starterSvg(ref));
  });

  app.get('/api/locations/:ref/map/check', async (request) =>
    maps.check(parse(RefParams, request.params).ref),
  );

  app.delete('/api/locations/:ref/map', async (request, reply) => {
    await maps.removeMap(parse(RefParams, request.params).ref, request.actor);
    return reply.status(204).send();
  });
}
