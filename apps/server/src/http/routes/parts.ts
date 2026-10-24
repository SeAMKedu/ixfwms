import {
  AttributeFields,
  CreatePartInput,
  PART_STATUSES,
  PartSearchInput,
  UpdatePartInput,
  parseAttributeFilter,
} from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, QueryBool, type AppDeps } from '../context.js';

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

const SearchQuery = PartSearchInput.omit({ attributes: true }).extend({
  inStock: QueryBool.optional(),
  lowStock: QueryBool.optional(),
  attr: AttrQuery.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function registerPartRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { parts, categories } = services;

  app.get('/api/parts', async (request) => {
    const { attr, ...q } = parse(SearchQuery, request.query);
    return parts.search({ ...q, attributes: attr });
  });

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

  app.get('/api/categories', () => categories.list());

  app.get('/api/categories/fields', async (request) => {
    const { path } = parse(z.object({ path: z.string().min(1) }), request.query);
    return categories.fields(path);
  });

  app.put('/api/categories/fields', async (request) => {
    const body = parse(
      z.object({ path: z.string().trim().min(1), fields: AttributeFields }),
      request.body,
    );
    return categories.setFields(body.path, body.fields, request.actor);
  });

  /** Renames or moves a category with everything below it; `to` is the new full path. */
  app.post('/api/categories/move', async (request) => {
    const body = parse(
      z.object({ path: z.string().trim().min(1), to: z.string().trim().min(1).max(300) }),
      request.body,
    );
    return { path: await categories.move(body.path, body.to, request.actor) };
  });

  /** Deletes a category without sub-categories; its parts go to `moveTo`. */
  app.delete('/api/categories', async (request) => {
    const query = parse(
      z.object({ path: z.string().trim().min(1), moveTo: z.string().trim().max(300).optional() }),
      request.query,
    );
    return { moved: await categories.remove(query.path, query.moveTo || null, request.actor) };
  });

  app.post('/api/categories/starter', async (request) => ({
    added: await categories.seedStarter(request.actor),
  }));
  app.get('/api/tags', () => parts.listTags());
}
