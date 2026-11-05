import { AttributeFields } from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, type AppDeps } from '../../http/context.js';

/** Categories: the tree, the fields each defines, moving and deleting them. */
export function categoriesRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { categories } = services;

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
}
