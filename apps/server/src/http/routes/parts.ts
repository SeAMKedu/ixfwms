import { CreatePartInput, PART_STATUSES, PartSearchInput, UpdatePartInput } from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, QueryBool, type AppDeps } from '../context.js';

const RefParams = z.object({ ref: z.string() });

const SearchQuery = PartSearchInput.extend({
  inStock: QueryBool.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function registerPartRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { parts } = services;

  app.get('/api/parts', async (request) => parts.search(parse(SearchQuery, request.query)));

  app.get('/api/parts/:ref', async (request) => parts.get(parse(RefParams, request.params).ref));

  app.post('/api/parts', async (request, reply) => {
    const created = await parts.create(parse(CreatePartInput, request.body), request.actor);
    return reply.status(201).send(created);
  });

  app.post('/api/parts/similar', async (request) => {
    const body = parse(
      z.object({ name: z.string().nullish(), identifiers: z.array(z.string()).default([]) }),
      request.body,
    );
    return parts.findSimilar(body.name ?? null, body.identifiers);
  });

  app.patch('/api/parts/:ref', async (request) => {
    const { ref } = parse(RefParams, request.params);
    return parts.update(ref, parse(UpdatePartInput, request.body), request.actor);
  });

  app.post('/api/parts/:ref/status', async (request) => {
    const { ref } = parse(RefParams, request.params);
    const { status } = parse(z.object({ status: z.enum(PART_STATUSES) }), request.body);
    return parts.setStatus(ref, status, request.actor);
  });

  app.post('/api/parts/:ref/merge', async (request) => {
    const { ref } = parse(RefParams, request.params);
    const { into } = parse(z.object({ into: z.string() }), request.body);
    return parts.mergeInto(ref, into, request.actor);
  });

  app.get('/api/categories', () => parts.listCategories());
  app.get('/api/tags', () => parts.listTags());
}
