import { MAP_KINDS } from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, type AppDeps } from '../../http/context.js';

const RefParams = z.object({ ref: z.string() });
const IdParams = z.object({ id: z.string() });
const KindQuery = z.object({ kind: z.enum(MAP_KINDS).default('svg_2d') });
const FileBody = z.object({ fileId: z.string().min(1) });

export function mapsRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { maps } = services;

  /** The drawings to show for "where is it?", from the top level down. */
  app.get('/api/maps/:ref', async (request) => maps.layers(parse(RefParams, request.params).ref));

  // --- the library of drawings, shared between places ---

  app.get('/api/map-drawings', async () => maps.drawings());

  app.post('/api/map-drawings', async (request, reply) => {
    const { fileId, name } = parse(
      FileBody.extend({ name: z.string().trim().min(1).max(200).nullish() }),
      request.body,
    );
    return reply.status(201).send(await maps.createDrawing(fileId, name ?? null, request.actor));
  });

  /** A new version of the drawing, for every place that uses it. */
  app.put('/api/map-drawings/:id', async (request) => {
    const { fileId } = parse(FileBody, request.body);
    return maps.replaceDrawing(parse(IdParams, request.params).id, fileId, request.actor);
  });

  app.patch('/api/map-drawings/:id', async (request, reply) => {
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(200) }), request.body);
    await maps.renameDrawing(parse(IdParams, request.params).id, name, request.actor);
    return reply.status(204).send();
  });

  app.delete('/api/map-drawings/:id', async (request, reply) => {
    await maps.deleteDrawing(parse(IdParams, request.params).id, request.actor);
    return reply.status(204).send();
  });

  // --- one place's maps ---

  app.put('/api/locations/:ref/map', async (request) => {
    const { ref } = parse(RefParams, request.params);
    return maps.setMap(ref, parse(FileBody, request.body).fileId, request.actor);
  });

  /** Use a drawing from the library, optionally linked like another place that uses it. */
  app.post('/api/locations/:ref/map/attach', async (request) => {
    const { ref } = parse(RefParams, request.params);
    const body = parse(
      z.object({ drawingId: z.string().min(1), copyFrom: z.string().nullish() }),
      request.body,
    );
    return maps.attach(ref, body.drawingId, body.copyFrom ?? null, request.actor);
  });

  /** Link a shape (SVG id or 3D object name) to a sub-place, or unlink it with `target: null`. */
  app.put('/api/locations/:ref/map/links', async (request) => {
    const { ref } = parse(RefParams, request.params);
    const body = parse(
      z.object({
        kind: z.enum(MAP_KINDS).default('svg_2d'),
        elementKey: z.string().min(1).max(500),
        target: z.string().nullable(),
      }),
      request.body,
    );
    return maps.setLink(ref, body.kind, body.elementKey, body.target, request.actor);
  });

  app.post('/api/locations/:ref/map/copy-links', async (request) => {
    const { ref } = parse(RefParams, request.params);
    const body = parse(
      z.object({ kind: z.enum(MAP_KINDS).default('svg_2d'), from: z.string().min(1) }),
      request.body,
    );
    return maps.copyLinks(ref, body.kind, body.from, request.actor);
  });

  app.get('/api/locations/:ref/map/starter.svg', async (request, reply) => {
    const { ref } = parse(RefParams, request.params);
    return reply
      .type('image/svg+xml')
      .header('content-disposition', `attachment; filename="ixfwms-map-${ref}.svg"`)
      .send(await maps.starterSvg(ref));
  });

  app.get('/api/locations/:ref/map/check', async (request) =>
    maps.check(parse(RefParams, request.params).ref, parse(KindQuery, request.query).kind),
  );

  app.delete('/api/locations/:ref/map', async (request, reply) => {
    await maps.removeMap(
      parse(RefParams, request.params).ref,
      parse(KindQuery, request.query).kind,
      request.actor,
    );
    return reply.status(204).send();
  });
}
