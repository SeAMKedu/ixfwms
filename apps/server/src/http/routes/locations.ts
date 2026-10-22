import { CreateLocationInput, UpdateLocationInput, buildCodeUrl } from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { baseUrl, parse, QueryBool, type AppDeps } from '../context.js';

const RefParams = z.object({ ref: z.string() });

export function registerLocationRoutes(app: FastifyInstance, { config, services }: AppDeps): void {
  const { locations, locationViews } = services;

  app.get('/api/locations', async (request) => {
    const q = parse(
      z.object({
        parent: z.string().optional(),
        tree: QueryBool.optional(),
        depth: z.coerce.number().int().min(1).max(20).optional(),
      }),
      request.query,
    );
    if (q.tree) return locations.tree(q.parent ?? null, q.depth ?? 10);
    return locations.children(q.parent ?? null);
  });

  app.get('/api/locations/:ref', async (request) => {
    const { ref } = parse(RefParams, request.params);
    const { recursive } = parse(z.object({ recursive: QueryBool.optional() }), request.query);
    return locationViews.detail(ref, { recursive: recursive ?? false });
  });

  app.post('/api/locations', async (request, reply) => {
    const created = await locations.create(parse(CreateLocationInput, request.body), request.actor);
    return reply.status(201).send(created);
  });

  app.patch('/api/locations/:ref', async (request) => {
    const { ref } = parse(RefParams, request.params);
    return locations.update(ref, parse(UpdateLocationInput, request.body), request.actor);
  });

  app.post('/api/locations/:ref/move', async (request) => {
    const { ref } = parse(RefParams, request.params);
    const { parent } = parse(z.object({ parent: z.string().nullable() }), request.body);
    return locations.move(ref, parent, request.actor);
  });

  /** Data for printing a label: what the QR encodes and the text next to it. */
  app.get('/api/locations/:ref/label', async (request) => {
    const { ref } = parse(RefParams, request.params);
    const loc = await locations.resolve(ref);
    const path = await locations.pathOf(loc);
    return {
      code: loc.code,
      name: loc.name,
      path: path.map((p) => p.name).join(' › '),
      qr: buildCodeUrl(baseUrl(config, request), 'location', loc.code),
    };
  });
}
