import {
  CreatePartInput,
  PART_STATUSES,
  PartSearchInput,
  UpdatePartInput,
  parseAttributeFilter,
  SimilarPartsInput,
} from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OPEN, parse, QueryBool, type AppDeps } from '../../http/context.js';

const RefParams = z.object({ ref: z.string() });

/** `?attr=thread:M4&attr=lengthMm>=10`: repeated query parameters become attribute filters. */
const AttrQuery = z.union([z.string(), z.array(z.string())]).transform((v, ctx) =>
  (Array.isArray(v) ? v : [v]).map((text) => {
    const filter = parseAttributeFilter(text);
    if (!filter)
      ctx.addIssue({
        code: 'custom',
        message: `Can't read attribute filter "${text}" (use key:value, key>=n, key<=n or key~text)`,
      });
    return filter!;
  }),
);

const SearchQuery = PartSearchInput.omit({ attributes: true, tags: true }).extend({
  inStock: QueryBool.optional(),
  lowStock: QueryBool.optional(),
  uncounted: QueryBool.optional(),
  byUnit: QueryBool.default(true),
  attr: AttrQuery.optional(),
  /** `?tag=a&tag=b`: items with all of them. */
  tag: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .pipe(PartSearchInput.shape.tags.unwrap())
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function partsRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { parts } = services;

  app.get('/api/parts', async (request) => {
    const { attr, tag, ...q } = parse(SearchQuery, request.query);
    return parts.search({ ...q, tags: tag, attributes: attr });
  });

  app.get('/api/parts/:ref', async (request) => parts.get(parse(RefParams, request.params).ref));

  app.post('/api/parts', async (request, reply) => {
    const created = await parts.create(parse(CreatePartInput, request.body), request.actor);
    return reply.status(201).send(created);
  });

  app.post('/api/parts/similar', OPEN, async (request) => {
    const body = parse(SimilarPartsInput, request.body);
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

  /** Deletes an item made by mistake (see DeleteService for when it may go). */
  app.delete('/api/parts/:ref', async (request, reply) => {
    await services.deletes.part(
      parse(z.object({ ref: z.string() }), request.params).ref,
      request.actor,
    );
    return reply.status(204).send();
  });

  app.post('/api/parts/:ref/merge', async (request) => {
    const { ref } = parse(RefParams, request.params);
    const { into } = parse(z.object({ into: z.string() }), request.body);
    return parts.mergeInto(ref, into, request.actor);
  });

  app.get('/api/tags', () => parts.listTags());
}
