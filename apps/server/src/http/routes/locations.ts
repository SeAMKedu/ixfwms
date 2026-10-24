import {
  CreateLocationInput,
  DismantleInput,
  DuplicateLocationInput,
  MakeBuildInput,
  LocationTypeInput,
  UpdateLocationInput,
  buildCodeUrl,
} from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { placeName } from '../../services/context.js';
import { baseUrl, parse, QueryBool, type AppDeps } from '../context.js';

const RefParams = z.object({ ref: z.string() });

export function registerLocationRoutes(app: FastifyInstance, { config, services }: AppDeps): void {
  const { builds, locations, locationViews, maps, placeTypes } = services;

  app.get('/api/locations', async (request) => {
    const q = parse(
      z.object({
        parent: z.string().optional(),
        tree: QueryBool.optional(),
        flat: QueryBool.optional(),
        depth: z.coerce.number().int().min(1).max(20).optional(),
      }),
      request.query,
    );
    if (q.flat) return locations.allWithPaths();
    if (q.tree) return locations.tree(q.parent ?? null, q.depth ?? 10);
    return locations.children(q.parent ?? null);
  });

  /** Place types: what can be picked for a place, and which are movable containers. */
  app.get('/api/location-types', async () => placeTypes.types());

  app.post('/api/location-types', async (request, reply) =>
    reply
      .status(201)
      .send(await placeTypes.createType(parse(LocationTypeInput, request.body), request.actor)),
  );

  app.patch('/api/location-types/:key', async (request) => {
    const { key } = parse(z.object({ key: z.string() }), request.params);
    return placeTypes.updateType(
      key,
      parse(LocationTypeInput.partial(), request.body),
      request.actor,
    );
  });

  app.delete('/api/location-types/:key', async (request, reply) => {
    const { key } = parse(z.object({ key: z.string() }), request.params);
    await placeTypes.deleteType(key, request.actor);
    return reply.status(204).send();
  });

  /** Temporary places left untouched longer than expected. */
  app.get('/api/locations/overdue', async () => locations.overdue());

  app.post('/api/locations/:ref/still-needed', async (request) =>
    locations.stillNeeded(parse(RefParams, request.params).ref, request.actor),
  );

  app.get('/api/locations/:ref', async (request) => {
    const { ref } = parse(RefParams, request.params);
    const { recursive } = parse(z.object({ recursive: QueryBool.optional() }), request.query);
    return locationViews.detail(ref, { recursive: recursive ?? false });
  });

  app.post('/api/locations', async (request, reply) => {
    const created = await locations.create(parse(CreateLocationInput, request.body), request.actor);
    return reply.status(201).send(created);
  });

  /** A build made from a parts list: the parts are moved in from free stock. */
  app.post('/api/builds', async (request, reply) =>
    reply.status(201).send(await builds.make(parse(MakeBuildInput, request.body), request.actor)),
  );

  /** Takes a build apart: back where everything came from, or onto `to`. */
  app.post('/api/locations/:ref/dismantle', async (request) =>
    builds.dismantle(
      parse(RefParams, request.params).ref,
      parse(DismantleInput, request.body ?? {}),
      request.actor,
    ),
  );

  app.patch('/api/locations/:ref', async (request) => {
    const { ref } = parse(RefParams, request.params);
    return locations.update(ref, parse(UpdateLocationInput, request.body), request.actor);
  });

  app.post('/api/locations/:ref/move', async (request) => {
    const { ref } = parse(RefParams, request.params);
    const { parent } = parse(z.object({ parent: z.string().nullable() }), request.body);
    return locations.move(ref, parent, request.actor);
  });

  /** Copies a place with everything below it (not stock), e.g. six more cabinets like this one. */
  app.post('/api/locations/:ref/duplicate', async (request, reply) => {
    const { ref } = parse(RefParams, request.params);
    const input = parse(DuplicateLocationInput, request.body ?? {});
    const copies = await locations.duplicate(ref, input, request.actor, (tx, pairs) =>
      input.maps ? maps.copyMapsFor(tx, pairs) : Promise.resolve(),
    );
    return reply.status(201).send(copies);
  });

  /** Data for printing a label: what the QR encodes and the text next to it. */
  app.get('/api/locations/:ref/label', async (request) => {
    const { ref } = parse(RefParams, request.params);
    const loc = await locations.resolve(ref);
    const path = await locations.pathOf(loc);
    return {
      code: loc.code,
      name: placeName(loc),
      path: path.map((p) => p.name).join(' › '),
      qr: buildCodeUrl(baseUrl(config, request), 'location', loc.code),
    };
  });
}
